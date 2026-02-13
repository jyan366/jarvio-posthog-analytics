#!/bin/bash
# Refresh dashboard with new PostHog report data
# Usage: ./refresh.sh [path/to/report.md]

set -e

REPORT="${1:-data/sample_report.md}"
JSON="data/customer_data.json"

echo "📊 Parsing report: $REPORT"
python3 src/parse_report.py "$REPORT" "$JSON"

echo "🎨 Generating dashboard..."
python3 src/generate_dashboard.py "$JSON" dashboard.html

echo ""
echo "✅ Done! Open dashboard.html in your browser."
