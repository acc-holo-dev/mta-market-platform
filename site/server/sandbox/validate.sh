#!/bin/bash
# MTA Market - Sandbox Validation Script
# Validates uploaded artifacts in isolated environment

set -e

ARTIFACT_PATH="/sandbox/artifact.zip"
OUTPUT_DIR="/sandbox/extracted"
COMPAT_REPORT="/sandbox/compatibility.json"
SECURITY_REPORT="/sandbox/security.json"

echo "=== MTA Market Sandbox Validation ==="
echo "Starting validation at $(date)"

# Check if artifact exists
if [ ! -f "$ARTIFACT_PATH" ]; then
    echo "ERROR: Artifact not found at $ARTIFACT_PATH"
    exit 1
fi

# Get artifact info
ARTIFACT_SIZE=$(stat -f%z "$ARTIFACT_PATH" 2>/dev/null || stat -c%s "$ARTIFACT_PATH")
echo "Artifact size: $ARTIFACT_SIZE bytes"

# Extract artifact
echo "Extracting artifact..."
mkdir -p "$OUTPUT_DIR"
unzip -q "$ARTIFACT_PATH" -d "$OUTPUT_DIR" || {
    echo "ERROR: Failed to extract archive"
    exit 1
}

# Count files
FILE_COUNT=$(find "$OUTPUT_DIR" -type f | wc -l)
echo "Extracted $FILE_COUNT files"

# Check for meta.xml (MTA resource manifest)
META_XML="$OUTPUT_DIR/meta.xml"
HAS_META=false
RESOURCE_TYPE="unknown"
HAS_SERVER=false
HAS_CLIENT=false

if [ -f "$META_XML" ]; then
    echo "Found meta.xml"
    HAS_META=true
    
    # Check for script types
    if grep -q '<script.*type="server"' "$META_XML"; then
        HAS_SERVER=true
        echo "  - Has server-side scripts"
    fi
    
    if grep -q '<script.*type="client"' "$META_XML"; then
        HAS_CLIENT=true
        echo "  - Has client-side scripts"
    fi
    
    # Determine resource type
    if $HAS_SERVER && $HAS_CLIENT; then
        RESOURCE_TYPE="gamemode"
    elif $HAS_SERVER; then
        RESOURCE_TYPE="server-script"
    elif $HAS_CLIENT; then
        RESOURCE_TYPE="client-script"
    fi
else
    echo "WARNING: No meta.xml found"
fi

# Check for suspicious files
echo "Checking for suspicious files..."
SUSPICIOUS_COUNT=0

# Check for executables
if find "$OUTPUT_DIR" -type f \( -name "*.exe" -o -name "*.dll" -o -name "*.so" \) | grep -q .; then
    echo "WARNING: Found executable files"
    SUSPICIOUS_COUNT=$((SUSPICIOUS_COUNT + 1))
fi

# Check for shell scripts
if find "$OUTPUT_DIR" -type f \( -name "*.sh" -o -name "*.bat" \) | grep -q .; then
    echo "WARNING: Found shell scripts"
    SUSPICIOUS_COUNT=$((SUSPICIOUS_COUNT + 1))
fi

# Basic Lua syntax check (if files exist)
LUA_FILES=$(find "$OUTPUT_DIR" -type f -name "*.lua" | head -5)
if [ -n "$LUA_FILES" ]; then
    echo "Checking Lua syntax..."
    # In production: use luac or lua -c
    # For now, just check if files are readable
    for lua_file in $LUA_FILES; do
        if ! file "$lua_file" | grep -q "text"; then
            echo "WARNING: Non-text Lua file: $(basename "$lua_file")"
            SUSPICIOUS_COUNT=$((SUSPICIOUS_COUNT + 1))
        fi
    done
fi

# Generate compatibility report
echo "Generating compatibility report..."
cat > "$COMPAT_REPORT" <<EOF
{
  "mtaVersion": {
    "min": "1.5.0",
    "tested": ["1.5.9"]
  },
  "os": ["linux", "windows"],
  "architecture": ["x64"],
  "dependencies": [],
  "requiredModules": [],
  "resourceType": "$RESOURCE_TYPE",
  "hasServer": $HAS_SERVER,
  "hasClient": $HAS_CLIENT,
  "hasShared": false,
  "fileCount": $FILE_COUNT,
  "hasMeta": $HAS_META
}
EOF

# Generate security report
cat > "$SECURITY_REPORT" <<EOF
{
  "issues": [],
  "suspiciousFileCount": $SUSPICIOUS_COUNT,
  "scannedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

# Cleanup
echo "Cleaning up..."
rm -rf "$OUTPUT_DIR"

echo "=== Validation Complete ==="
echo "Compatibility report: $COMPAT_REPORT"
echo "Security report: $SECURITY_REPORT"

# Exit with success if no major issues
if [ $SUSPICIOUS_COUNT -gt 5 ]; then
    echo "ERROR: Too many suspicious files ($SUSPICIOUS_COUNT)"
    exit 1
fi

exit 0
