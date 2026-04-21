/**
 * incentiveCalc.js
 * Pure functions — no side effects, no Supabase calls.
 * Used both in the app and in the What-If simulator.
 */

/**
 * Calculate incentive for a staff member for a given month.
 *
 * @param {Object} params
 * @param {number} params.monthlySalary
 * @param {number} params.salesMultiplier   default 5
 * @param {number} params.newClientRate     default 0.05
 * @param {number} params.renewalRate       default 0.02
 * @param {number} params.flatBonus         default 10000
 * @param {number} params.newClientRevenue  revenue from new clients this month
 * @param {number} params.renewalRevenue    revenue from renewals this month
 *
 * @returns {Object} { total, target, threshold, incentive, flatBonus, slabReached, targetExceeded }
 */
export function calculateIncentive({
  monthlySalary,
  salesMultiplier = 5,
  newClientRate = 0.05,
  renewalRate = 0.02,
  flatBonus = 10000,
  newClientRevenue = 0,
  renewalRevenue = 0,
}) {
  const target = monthlySalary * salesMultiplier
  const threshold = monthlySalary * 2
  const total = newClientRevenue + renewalRevenue

  const slabReached = total >= threshold
  const targetExceeded = total > target

  let baseIncentive = 0
  let bonusAmount = 0

  if (!slabReached) {
    return {
      total,
      target,
      threshold,
      incentive: 0,
      flatBonus: 0,
      slabReached: false,
      targetExceeded: false,
      baseIncentive: 0,
      progressToThreshold: Math.min(total / threshold, 1),
      progressToTarget: Math.min(total / target, 1),
    }
  }

  baseIncentive =
    newClientRevenue * newClientRate + renewalRevenue * renewalRate

  if (targetExceeded) {
    bonusAmount = flatBonus
  }

  const incentive = baseIncentive + bonusAmount

  return {
    total,
    target,
    threshold,
    incentive,
    flatBonus: bonusAmount,
    slabReached: true,
    targetExceeded,
    baseIncentive,
    progressToThreshold: 1,
    progressToTarget: Math.min(total / target, 1),
  }
}

/**
 * Calculate streak: consecutive months where total > target
 *
 * @param {Array} monthlyData  Array of { month_year, new_client_revenue, renewal_revenue }
 * @param {number} target
 * @returns {number} streak count (consecutive from most recent)
 */
export function calculateStreak(monthlyData, target) {
  if (!monthlyData?.length) return 0

  // Sort descending
  const sorted = [...monthlyData].sort((a, b) => b.month_year.localeCompare(a.month_year))

  let streak = 0
  for (const row of sorted) {
    const total = (row.new_client_revenue || 0) + (row.renewal_revenue || 0)
    if (total > target) {
      streak++
    } else {
      break
    }
  }
  return streak
}

/**
 * Returns true if increment alert should be shown
 */
export function isIncrementEligible(streak) {
  return streak >= 6
}

/**
 * What-If simulator helper — returns incentive for a range of revenue values
 *
 * @param {Object} profile  staff_incentive_profiles row
 * @param {number} steps    number of data points to generate
 * @returns {Array} [{ revenue, incentive }]
 */
export function generateWhatIfData(profile, steps = 20) {
  const target = profile.monthly_salary * profile.sales_multiplier
  const maxRevenue = target * 1.5

  const result = []
  for (let i = 0; i <= steps; i++) {
    const revenue = (maxRevenue / steps) * i
    const { incentive } = calculateIncentive({
      ...profile,
      newClientRevenue: revenue,
      renewalRevenue: 0,
    })
    result.push({ revenue, incentive })
  }
  return result
}
