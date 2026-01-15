#!/bin/bash

###############################################################################
# Nora Word Security Scanner
# Comprehensive security testing automation script
###############################################################################

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Report directory
REPORT_DIR="security-reports"
TIMESTAMP=$(date +"%Y%m%d-%H%M%S")
REPORT_FILE="${REPORT_DIR}/security-scan-${TIMESTAMP}.txt"

# Create report directory
mkdir -p "$REPORT_DIR"

echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║         Nora Word Security Testing Suite                  ║${NC}"
echo -e "${BLUE}║         Comprehensive Security Audit                      ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Initialize report
cat > "$REPORT_FILE" <<EOF
NORA WORD SECURITY SCAN REPORT
Generated: $(date)
Environment: $(node --version)
Working Directory: $(pwd)

EOF

###############################################################################
# Function: Print section header
###############################################################################
print_section() {
    echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
    echo "" >> "$REPORT_FILE"
    echo "═══════════════════════════════════════════════════════════" >> "$REPORT_FILE"
    echo "$1" >> "$REPORT_FILE"
    echo "═══════════════════════════════════════════════════════════" >> "$REPORT_FILE"
}

###############################################################################
# Function: Check if command exists
###############################################################################
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

###############################################################################
# 1. DEPENDENCY VULNERABILITY SCANNING
###############################################################################
print_section "1. Dependency Vulnerability Scan"

echo -e "${YELLOW}Running npm audit...${NC}"
if npm audit --audit-level=moderate >> "$REPORT_FILE" 2>&1; then
    echo -e "${GREEN}✓ No vulnerabilities found${NC}"
else
    echo -e "${RED}✗ Vulnerabilities detected! Check report for details.${NC}"
fi

if command_exists snyk; then
    echo -e "${YELLOW}Running Snyk scan...${NC}"
    if snyk test --severity-threshold=high >> "$REPORT_FILE" 2>&1; then
        echo -e "${GREEN}✓ Snyk scan passed${NC}"
    else
        echo -e "${RED}✗ Snyk detected issues${NC}"
    fi
else
    echo -e "${YELLOW}⚠ Snyk not installed. Skipping. Install: npm install -g snyk${NC}"
fi

if command_exists retire; then
    echo -e "${YELLOW}Running Retire.js...${NC}"
    retire --path . --outputformat text >> "$REPORT_FILE" 2>&1 || true
    echo -e "${GREEN}✓ Retire.js scan complete${NC}"
else
    echo -e "${YELLOW}⚠ Retire.js not installed. Skipping. Install: npm install -g retire${NC}"
fi

###############################################################################
# 2. STATIC CODE ANALYSIS (SAST)
###############################################################################
print_section "2. Static Application Security Testing (SAST)"

echo -e "${YELLOW}Running ESLint security checks...${NC}"
if npx eslint . --ext .ts,.tsx --config .eslintrc.security.json >> "$REPORT_FILE" 2>&1; then
    echo -e "${GREEN}✓ ESLint security checks passed${NC}"
else
    echo -e "${RED}✗ ESLint found security issues${NC}"
fi

if command_exists semgrep; then
    echo -e "${YELLOW}Running Semgrep...${NC}"
    semgrep --config=p/security-audit \
            --config=p/react \
            --config=p/typescript \
            --config=p/owasp-top-ten \
            --json \
            . > "${REPORT_DIR}/semgrep-${TIMESTAMP}.json" 2>&1 || true
    echo -e "${GREEN}✓ Semgrep scan complete${NC}"
else
    echo -e "${YELLOW}⚠ Semgrep not installed. Install: pip install semgrep${NC}"
fi

###############################################################################
# 3. SECRET DETECTION
###############################################################################
print_section "3. Secret Detection"

echo -e "${YELLOW}Scanning for hardcoded secrets...${NC}"

# Check for API keys
echo "Checking for API key patterns..." >> "$REPORT_FILE"
if grep -r "AIza[0-9A-Za-z-_]{35}" . --exclude-dir=node_modules --exclude-dir=.git >> "$REPORT_FILE" 2>&1; then
    echo -e "${RED}✗ Google API key pattern detected!${NC}"
else
    echo -e "${GREEN}✓ No Google API key patterns found${NC}"
fi

# Check for Supabase keys
if grep -r "sb_publishable_" . --exclude-dir=node_modules --exclude-dir=.git >> "$REPORT_FILE" 2>&1; then
    echo -e "${YELLOW}⚠ Supabase publishable key found (expected in client)${NC}"
fi

# Check for private keys
if find . -name "*.pem" -o -name "*.key" -o -name "*_rsa" | grep -v node_modules >> "$REPORT_FILE" 2>&1; then
    echo -e "${RED}✗ Private key files detected!${NC}"
else
    echo -e "${GREEN}✓ No private key files found${NC}"
fi

# Check for .env files
if find . -name ".env" -o -name ".env.local" | grep -v node_modules >> "$REPORT_FILE" 2>&1; then
    echo -e "${YELLOW}⚠ Environment files found (verify they're in .gitignore)${NC}"
fi

###############################################################################
# 4. BUILD ANALYSIS
###############################################################################
print_section "4. Production Build Analysis"

echo -e "${YELLOW}Building production bundle...${NC}"
npm run build >> "$REPORT_FILE" 2>&1

echo -e "${YELLOW}Analyzing build output for secrets...${NC}"
BUILD_DIR="dist"

if [ -d "$BUILD_DIR" ]; then
    # Check for API keys in build
    echo "Checking build for embedded secrets..." >> "$REPORT_FILE"

    if grep -r "GEMINI_API_KEY" "$BUILD_DIR" >> "$REPORT_FILE" 2>&1; then
        echo -e "${RED}✗ CRITICAL: Gemini API key found in production build!${NC}"
    else
        echo -e "${GREEN}✓ No Gemini API key in build${NC}"
    fi

    if grep -r "process.env.API_KEY" "$BUILD_DIR" >> "$REPORT_FILE" 2>&1; then
        echo -e "${RED}✗ CRITICAL: API_KEY reference in production build!${NC}"
    else
        echo -e "${GREEN}✓ No API_KEY references in build${NC}"
    fi

    # Check bundle size
    echo -e "${YELLOW}Build size analysis:${NC}"
    du -sh "$BUILD_DIR" | tee -a "$REPORT_FILE"
else
    echo -e "${RED}✗ Build directory not found${NC}"
fi

###############################################################################
# 5. CONFIGURATION REVIEW
###############################################################################
print_section "5. Security Configuration Review"

echo -e "${YELLOW}Checking security headers configuration...${NC}"

# Check for CSP
if grep -r "Content-Security-Policy" . --include="*.html" --include="*.ts" >> "$REPORT_FILE" 2>&1; then
    echo -e "${GREEN}✓ CSP configuration found${NC}"
else
    echo -e "${RED}✗ No Content Security Policy detected${NC}"
fi

# Check CORS configuration
echo -e "${YELLOW}Reviewing CORS settings...${NC}"
echo "Note: Verify CORS settings in Supabase dashboard" >> "$REPORT_FILE"

###############################################################################
# 6. CODE PATTERN ANALYSIS
###############################################################################
print_section "6. Dangerous Code Pattern Detection"

echo -e "${YELLOW}Scanning for dangerous patterns...${NC}"

# Check for eval usage
if grep -r "eval(" . --include="*.ts" --include="*.tsx" --exclude-dir=node_modules >> "$REPORT_FILE" 2>&1; then
    echo -e "${RED}✗ eval() usage detected${NC}"
else
    echo -e "${GREEN}✓ No eval() usage${NC}"
fi

# Check for dangerouslySetInnerHTML
if grep -r "dangerouslySetInnerHTML" . --include="*.tsx" --exclude-dir=node_modules >> "$REPORT_FILE" 2>&1; then
    echo -e "${RED}✗ dangerouslySetInnerHTML usage detected${NC}"
else
    echo -e "${GREEN}✓ No dangerouslySetInnerHTML usage${NC}"
fi

# Check for direct SQL queries
if grep -r "DROP TABLE\|DELETE FROM\|UPDATE.*SET" . --include="*.ts" --exclude-dir=node_modules --exclude-dir=tests >> "$REPORT_FILE" 2>&1; then
    echo -e "${YELLOW}⚠ SQL query patterns detected (review for safety)${NC}"
else
    echo -e "${GREEN}✓ No direct SQL query patterns${NC}"
fi

###############################################################################
# 7. AUTHENTICATION & AUTHORIZATION CHECKS
###############################################################################
print_section "7. Authentication & Authorization Review"

echo -e "${YELLOW}Checking for user isolation in queries...${NC}"

# Check if queries filter by user_id
if ! grep -A 5 "from('word-history')" services/dataService.ts | grep -q "eq('user_id'"; then
    echo -e "${RED}✗ CRITICAL: word-history queries missing user_id filter!${NC}"
    echo "CRITICAL: word-history missing user_id filter" >> "$REPORT_FILE"
else
    echo -e "${GREEN}✓ word-history has user_id filtering${NC}"
fi

# Note: word-playbooks table removed by design (see plan). Check skipped.
echo -e "${GREEN}✓ word-playbooks check skipped (table removed as per design)${NC}"

###############################################################################
# 8. SECURITY TEST EXECUTION
###############################################################################
print_section "8. Security Unit Tests"

echo -e "${YELLOW}Running security test suites...${NC}"

if npm test -- --run tests/security/ >> "$REPORT_FILE" 2>&1; then
    echo -e "${GREEN}✓ All security tests passed${NC}"
else
    echo -e "${RED}✗ Security tests failed${NC}"
fi

###############################################################################
# 9. FINAL SUMMARY
###############################################################################
print_section "9. Security Scan Summary"

echo -e "\n${BLUE}Security Scan Complete!${NC}"
echo -e "${BLUE}Report saved to: ${YELLOW}$REPORT_FILE${NC}\n"

# Count issues
CRITICAL_COUNT=$(grep -c "CRITICAL:" "$REPORT_FILE" 2>/dev/null || echo "0")
HIGH_COUNT=$(grep -c "HIGH:" "$REPORT_FILE" 2>/dev/null || echo "0")
MEDIUM_COUNT=$(grep -c "MEDIUM:" "$REPORT_FILE" 2>/dev/null || echo "0")

echo -e "Summary:" >> "$REPORT_FILE"
echo -e "  Critical Issues: $CRITICAL_COUNT" >> "$REPORT_FILE"
echo -e "  High Issues: $HIGH_COUNT" >> "$REPORT_FILE"
echo -e "  Medium Issues: $MEDIUM_COUNT" >> "$REPORT_FILE"

if [ "$CRITICAL_COUNT" -gt 0 ]; then
    echo -e "${RED}✗ CRITICAL ISSUES FOUND: $CRITICAL_COUNT${NC}"
    exit 1
elif [ "$HIGH_COUNT" -gt 0 ]; then
    echo -e "${YELLOW}⚠ HIGH PRIORITY ISSUES FOUND: $HIGH_COUNT${NC}"
    exit 1
else
    echo -e "${GREEN}✓ No critical or high priority issues detected${NC}"
    exit 0
fi
