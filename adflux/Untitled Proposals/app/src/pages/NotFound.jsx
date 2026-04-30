import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div style={{ padding: 48, textAlign: 'center' }}>
      <h1>404</h1>
      <p>That page doesn't exist.</p>
      <p><Link to="/">← Back to dashboard</Link></p>
    </div>
  );
}
