# HTML report generator

This repository now contains a print-ready HTML template, supporting styles, and a Node.js script that turns the provided CSV files into a four-page A4 HTML report.

## Files
- `template.html` – base template containing all placeholders and chart containers.
- `styles.css` – layout and print styling tuned for A4 output.
- `generate.js` – Node script that reads the supplied CSV files, formats values, builds chart data, and writes `output/<mpan>.html`.

## Running the generator
1. Ensure Node.js 18+ is available.
2. Place the CSV inputs at the default locations or override paths via environment variables:
   - Main CSV: `/mnt/data/Technical and Financial Output.csv` (override with `MAIN_CSV`)
   - Charts CSV: `/mnt/data/Outputs - Chart Financed (1).csv` (override with `CHART_CSV`)
3. Run the generator from the repository root:

```bash
node generate.js
```

The generated HTML will be written to `output/<mpan>.html` (MPAN is normalized from the CSV).

## Printing to PDF
Open the generated HTML in a Chromium-based browser and print to PDF with background graphics enabled. For a headless option:

```bash
chromium --headless --disable-gpu \
  --print-to-pdf=output/report.pdf \
  output/<mpan>.html
```

Adjust the output filename as needed and ensure the path to the HTML is correct.
