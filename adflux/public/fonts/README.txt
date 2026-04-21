This folder is currently UNUSED.

The PDF font (Roboto) is loaded from jsDelivr CDN at runtime — see
src/components/quotes/QuotePDF.jsx, the Font.register({ ... }) block.

If you ever want to eliminate the CDN dependency (for tighter control
over PDF generation reliability), drop these two files into this folder:

    Roboto-Regular.ttf
    Roboto-Bold.ttf

...then in QuotePDF.jsx change the two `src:` URLs from
    https://cdn.jsdelivr.net/gh/google/fonts@main/...
to
    /fonts/Roboto-Regular.ttf
    /fonts/Roboto-Bold.ttf

Source: https://fonts.google.com/specimen/Roboto (Apache 2.0 license,
free for commercial use).
