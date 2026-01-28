#!/bin/bash
# gather-docs-context.sh
# Gathers documentation context for regenerating llms.txt files
# Output can be fed to Claude Code for regeneration

set -e

DOCS_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUTPUT_FILE="${1:-/tmp/herdctl-docs-context.md}"

echo "Gathering docs context from: $DOCS_DIR"
echo "Output: $OUTPUT_FILE"
echo ""

cat > "$OUTPUT_FILE" << 'HEADER'
# herdctl Documentation Context

This file contains the current state of herdctl documentation for regenerating llms.txt files.

---

HEADER

# Section 1: Sidebar Structure
echo "## Sidebar Structure (from astro.config.mjs)" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"
echo "This shows the official documentation organization:" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"
echo '```javascript' >> "$OUTPUT_FILE"
grep -A 100 "sidebar:" "$DOCS_DIR/astro.config.mjs" | head -80 >> "$OUTPUT_FILE"
echo '```' >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

# Section 2: All Documentation Files
echo "## Documentation Files" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"
echo "All markdown/mdx files in the docs:" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"
echo '```' >> "$OUTPUT_FILE"
find "$DOCS_DIR/src/content/docs" \( -name "*.md" -o -name "*.mdx" \) | sort | sed "s|$DOCS_DIR/||" >> "$OUTPUT_FILE"
echo '```' >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

# Section 3: Extract frontmatter and first heading from each doc
echo "## Page Summaries" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"
echo "Title and description from each page:" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

for file in $(find "$DOCS_DIR/src/content/docs" \( -name "*.md" -o -name "*.mdx" \) | sort); do
    relative_path=$(echo "$file" | sed "s|$DOCS_DIR/src/content/docs/||" | sed 's/\.mdx\?$//' | sed 's/index$//')

    # Extract title from frontmatter
    title=$(grep -m1 "^title:" "$file" 2>/dev/null | sed 's/title: //' | tr -d '"' || echo "")

    # Extract description from frontmatter
    description=$(grep -m1 "^description:" "$file" 2>/dev/null | sed 's/description: //' | tr -d '"' || echo "")

    if [ -n "$title" ]; then
        echo "### /$relative_path" >> "$OUTPUT_FILE"
        echo "**Title:** $title" >> "$OUTPUT_FILE"
        if [ -n "$description" ]; then
            echo "**Description:** $description" >> "$OUTPUT_FILE"
        fi
        echo "" >> "$OUTPUT_FILE"
    fi
done

# Section 4: Key code examples (extract YAML examples from config docs)
echo "## Key Configuration Examples" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

for config_file in "$DOCS_DIR/src/content/docs/configuration"/*.md; do
    if [ -f "$config_file" ]; then
        basename=$(basename "$config_file" .md)
        echo "### $basename" >> "$OUTPUT_FILE"
        echo "" >> "$OUTPUT_FILE"
        # Extract first yaml code block
        awk '/```yaml/{flag=1; next} /```/{if(flag) exit} flag' "$config_file" | head -30 >> "$OUTPUT_FILE" || true
        echo "" >> "$OUTPUT_FILE"
    fi
done

# Section 5: CLI commands (if CLI reference exists)
CLI_REF="$DOCS_DIR/src/content/docs/cli-reference/index.mdx"
if [ -f "$CLI_REF" ]; then
    echo "## CLI Commands" >> "$OUTPUT_FILE"
    echo "" >> "$OUTPUT_FILE"
    echo "From cli-reference:" >> "$OUTPUT_FILE"
    echo "" >> "$OUTPUT_FILE"
    # Extract command sections
    grep -E "^###|herdctl " "$CLI_REF" | head -40 >> "$OUTPUT_FILE" || true
    echo "" >> "$OUTPUT_FILE"
fi

echo "---" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"
echo "Generated: $(date)" >> "$OUTPUT_FILE"

echo ""
echo "Done! Context file created at: $OUTPUT_FILE"
echo ""
echo "To regenerate llms.txt, ask Claude Code:"
echo ""
echo '  Read the context file at '"$OUTPUT_FILE"' and the current llms.txt files,'
echo '  then regenerate docs/public/llms.txt and docs/public/llms-full.txt'
echo '  following docs/scripts/generate-llms-txt.md'
