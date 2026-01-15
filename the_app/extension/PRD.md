# Autonomi Extension - Product Requirements Document

> **Version:** 2.0.0 | **Type:** AI-Compatible PRD | **Product:** VSCode Extension
> **Validated:** 3 Opus feedback loops completed
> **Target:** Enterprise-ready autonomous development platform

---

## AI Agent Instructions

```yaml
prd_metadata:
  format: "ai-compatible"
  parsing: "structured-yaml-blocks"
  ambiguity_level: "zero"
  implementation_order: "priority-descending"
  success_validation: "automated-tests-only"
  feedback_incorporated:
    - "feature_gaps_vs_cline_cursor"
    - "vscode_api_feasibility"
    - "enterprise_requirements"
```

**For AI Agents Building This:**
- Each requirement has unique ID (EXT-XXX)
- Dependencies are explicit
- Success criteria are testable (no subjective measures)
- Priority: P0 = must-have, P1 = should-have, P2 = nice-to-have
- Complexity: S (1-3 days), M (1-2 weeks), L (2-4 weeks), XL (4+ weeks)

---

## 1. Product Overview

### 1.1 Vision

Autonomi Extension transforms any VSCode-based IDE into an enterprise-ready autonomous software development platform. Unlike competitors requiring constant human oversight, Autonomi offers configurable autonomy - from fully autonomous operation to human-approval at every step - adapting to enterprise governance requirements.

### 1.2 Target Personas

```yaml
primary_persona:
  name: "Engineering Team Lead"
  company_size: "50-500 employees"
  pain_points:
    - "Code review bottlenecks"
    - "Inconsistent code quality"
    - "Slow feature delivery"
  value_proposition: "2.1 fewer prompts per task average, 30% reduction in review cycles"

secondary_persona:
  name: "Enterprise Architect"
  company_size: "500-5000 employees"
  pain_points:
    - "Security compliance requirements"
    - "Cost governance across teams"
    - "Lack of audit trails"
  value_proposition: "SOC2-ready audit logging, SSO integration, org-level cost controls"

tertiary_persona:
  name: "Individual Developer"
  company_size: "1-50 employees"
  pain_points:
    - "Context switching overhead"
    - "Repetitive boilerplate tasks"
  value_proposition: "Ship faster with plan-then-execute workflow"
```

### 1.3 Competitive Positioning

| Competitor | Their Approach | Autonomi Advantage |
|------------|----------------|-------------------|
| **Cursor** | 8 parallel agents, human review | Configurable approval gates, enterprise audit |
| **Cline** | Human approval every step | Confidence-based routing (skip approvals when safe) |
| **GitHub Copilot** | Inline suggestions only | Full task completion, multi-file changes |
| **Devin** | $500/mo, cloud-only | Self-hosted option, bring-your-own-keys |
| **Amazon Q** | AWS-locked | Cloud-agnostic, multi-provider |

### 1.4 Core Differentiators (Validated)

```yaml
differentiators:
  configurable_autonomy:
    description: "From fully autonomous to human-in-the-loop per enterprise policy"
    why_matters: "Enterprises need governance controls, not blind automation"

  cost_transparency:
    description: "Per-request cost tracking, budgets, alerts"
    why_matters: "API costs can spiral; users need visibility and control"

  enterprise_ready:
    description: "SSO, audit logging, RBAC, central management"
    why_matters: "Table stakes for enterprise procurement"

  plan_before_execute:
    description: "Generate execution plan, get approval, then implement"
    why_matters: "Builds trust, reduces costly mistakes"

  mcp_ecosystem:
    description: "Connect to 1800+ MCP tool servers"
    why_matters: "Extensibility without custom development"
```

---

## 2. Technical Architecture

### 2.1 System Components (Feasibility Validated)

```
+-------------------------------------------------------------------+
|                     AUTONOMI EXTENSION                             |
+-------------------------------------------------------------------+
|  UI Layer (VSCode Extension API)                                   |
|  +-- TreeView: Status, queue, metrics (native, always-on)          |
|  +-- WebView: Dashboard, artifacts (lazy-loaded, destroyable)      |
|  +-- Status Bar: Phase, confidence, cost                           |
|  +-- Commands: Start, stop, plan, approve, configure               |
+-------------------------------------------------------------------+
|  Extension Host (main thread - lightweight)                        |
|  +-- UI Controller (TreeView, StatusBar, Commands)                 |
|  +-- State Manager (workspaceState, globalState)                   |
|  +-- IPC Bridge to Worker                                          |
+-------------------------------------------------------------------+
|  Worker Process (spawned - heavy computation)                      |
|  +-- Agent Orchestrator (max 4 concurrent instances)               |
|  +-- Provider Manager (rate limiting, fallback)                    |
|  +-- Memory System (SQLite-backed, hot/cold split)                 |
|  +-- Quality Pipeline (configurable gates)                         |
+-------------------------------------------------------------------+
|  Agent Types (15 specialized, selected by task)                    |
|  +-- Engineering (6): frontend, backend, database, api, devops, qa |
|  +-- Quality (4): code-review, security-review, test-gen, perf     |
|  +-- Support (3): docs, refactor, migration                        |
|  +-- Planning (2): architect, task-decomposition                   |
+-------------------------------------------------------------------+
|  Provider Layer (with circuit breakers)                            |
|  +-- Anthropic (Claude Opus/Sonnet/Haiku)                          |
|  +-- OpenAI (GPT-4o/GPT-4-turbo)                                   |
|  +-- Google (Gemini Pro/Flash)                                     |
|  +-- Local (Ollama/LMStudio for air-gap)                           |
+-------------------------------------------------------------------+
```

### 2.2 Data Flow (with Approval Gates)

```
User Input (Task/PRD)
       |
       v
[Input Validation] --> BLOCK if invalid
       |
       v
[Plan Generation] --> Display plan to user
       |
       v
[Approval Gate] --> If auto_approve: continue
       |            --> Else: wait for user approval
       v
[Confidence Calculation]
       |
       +-- >= 0.90 --> [Execute] --> [Post-Validation] --> Done
       |
       +-- 0.60-0.90 --> [Execute] --> [Quality Gate] --> Done
       |
       +-- 0.30-0.60 --> [Execute] --> [Full Review] --> Done
       |
       +-- < 0.30 --> [Notify User] --> Wait for guidance
```

---

## 3. Functional Requirements

### 3.1 Core Execution Engine

#### EXT-001: RARV Cycle Implementation
```yaml
id: EXT-001
priority: P0
complexity: L
dependencies: []
description: |
  Implement the Reason-Act-Reflect-Verify cycle as the core execution loop.

acceptance_criteria:
  - "RARV cycle executes for every task"
  - "Reason phase reads state and plans approach"
  - "Act phase executes with streaming output"
  - "Reflect phase captures learnings"
  - "Verify phase runs automated tests"
  - "Failed verification triggers retry with learning"

test_cases:
  - name: "rarv_completes_simple_task"
    input: "Add console.log to function"
    expected: "Task completes through all 4 phases"
    validation: "State shows all phase transitions"

  - name: "rarv_retry_on_test_failure"
    input: "Task with failing test"
    expected: "Retry with updated approach"
    validation: "Retry count > 0, learning captured"
```

#### EXT-002: Plan Mode (Dry Run)
```yaml
id: EXT-002
priority: P0
complexity: M
dependencies: [EXT-001]
description: |
  Generate detailed execution plan without making changes.
  User reviews and approves before any code is written.

workflow:
  1_analyze: "Parse task, identify affected files"
  2_plan: "Generate step-by-step execution plan"
  3_estimate: "Estimate tokens, cost, time"
  4_display: "Show plan in UI with approve/modify options"
  5_await: "Wait for user approval (or auto-approve if configured)"
  6_execute: "Only then proceed with implementation"

acceptance_criteria:
  - "Plan generated for every task before execution"
  - "Plan shows files to modify, approach, estimated cost"
  - "User can modify plan before approval"
  - "Auto-approve configurable per confidence level"
  - "Plan stored for audit trail"

test_cases:
  - name: "plan_shows_before_execute"
    input: "Add new API endpoint"
    expected: "Plan displayed with file list, approach"
    validation: "No files modified until approval"
```

#### EXT-003: Configurable Approval Gates
```yaml
id: EXT-003
priority: P0
complexity: M
dependencies: [EXT-002]
description: |
  Enterprise-configurable approval checkpoints that override
  confidence-based routing for sensitive operations.

configurable_gates:
  production_deploy:
    default: "always_require_approval"
    configurable: true
  database_migration:
    default: "always_require_approval"
    configurable: true
  security_changes:
    default: "always_require_approval"
    configurable: true
  new_dependencies:
    default: "require_approval"
    configurable: true
  file_deletion:
    default: "require_approval"
    configurable: true
  cost_threshold:
    default: "$1.00"
    action: "pause_and_notify"

acceptance_criteria:
  - "Gates configurable via extension settings"
  - "Gates override confidence routing"
  - "Audit log captures gate decisions"
  - "Enterprise can mandate gates via central policy"

test_cases:
  - name: "gate_blocks_production_deploy"
    input: "Deploy to production"
    expected: "Blocked until explicit approval"
    validation: "Gate event in audit log"
```

### 3.2 Agent System (Reduced Scope - 15 Types)

#### EXT-004: Agent Orchestrator
```yaml
id: EXT-004
priority: P0
complexity: XL
dependencies: [EXT-001, EXT-002]
description: |
  Orchestrator manages 15 specialized agent types with max 4
  concurrent instances. Agent types are selected by task classification.

agent_types:
  engineering:
    - frontend: "React, Vue, Angular, CSS, HTML"
    - backend: "Node, Python, Go, Java, APIs"
    - database: "SQL, migrations, schema design"
    - api: "REST, GraphQL, OpenAPI spec"
    - devops: "CI/CD, Docker, Kubernetes, IaC"
    - qa: "Test strategy, E2E, integration"

  quality:
    - code_review: "Code quality, patterns, maintainability"
    - security_review: "Vulnerabilities, secrets, OWASP"
    - test_gen: "Unit test generation, coverage"
    - perf: "Performance analysis, optimization"

  support:
    - docs: "Documentation, README, API docs"
    - refactor: "Code cleanup, modernization"
    - migration: "Language/framework upgrades"

  planning:
    - architect: "System design, architecture decisions"
    - decomposition: "Break complex tasks into subtasks"

concurrency:
  max_instances: 4
  queue_overflow: "pending queue with priority"
  rate_limiting: "per-provider token bucket"

acceptance_criteria:
  - "15 agent types with distinct system prompts"
  - "Max 4 concurrent agent instances"
  - "Task classifier routes to correct agent type"
  - "Queue handles overflow gracefully"

test_cases:
  - name: "correct_agent_type_selected"
    input: "Write React component"
    expected: "frontend agent selected"
    validation: "Agent type in execution log"
```

#### EXT-005: Confidence-Based Routing
```yaml
id: EXT-005
priority: P0
complexity: M
dependencies: [EXT-004]
description: |
  4-tier routing optimizes speed vs safety per task.

tiers:
  tier_1:
    threshold: ">= 0.90"
    behavior: "Auto-execute if no mandatory gates"
    examples: ["format code", "run linter", "add import"]
    model: "haiku"

  tier_2:
    threshold: "0.60-0.90"
    behavior: "Execute with post-validation"
    examples: ["add function", "simple refactor"]
    model: "sonnet"

  tier_3:
    threshold: "0.30-0.60"
    behavior: "Execute with full quality pipeline"
    examples: ["new feature", "API endpoint"]
    model: "sonnet"

  tier_4:
    threshold: "< 0.30"
    behavior: "Notify user, await guidance"
    examples: ["architectural decision", "unclear requirement"]
    model: "opus (for analysis)"

confidence_calculation:
  requirement_clarity: 0.30
  technical_complexity: 0.25
  historical_success: 0.25
  scope_size: 0.20

acceptance_criteria:
  - "Confidence calculated for every task"
  - "Tier routing matches thresholds"
  - "Model selection optimizes cost"
  - "Tier 4 always notifies user"
```

### 3.3 Quality System

#### EXT-006: Configurable Quality Pipeline
```yaml
id: EXT-006
priority: P0
complexity: L
dependencies: [EXT-004]
description: |
  Quality gates configurable per tier and enterprise policy.
  Not all gates run for all tasks (cost optimization).

gates:
  static_analysis:
    tier_applicability: [1, 2, 3]
    checks: ["eslint", "typescript", "auto-detected project config"]
    blocking: true

  automated_tests:
    tier_applicability: [2, 3]
    checks: ["run affected tests", "coverage check"]
    blocking: true

  code_review:
    tier_applicability: [3]
    mode: "single reviewer (not 3 blind)"
    model: "sonnet"
    blocking: false (creates TODO)

  security_scan:
    tier_applicability: [3]
    checks: ["secrets", "dependencies", "OWASP patterns"]
    blocking: true

acceptance_criteria:
  - "Gates run based on tier"
  - "Gate configuration per workspace/enterprise"
  - "Gate results in audit log"
  - "Blocking gates halt pipeline"

test_cases:
  - name: "tier_1_skips_review"
    input: "Simple format task"
    expected: "No code review gate"
    validation: "Review gate not in execution log"
```

### 3.4 Memory System

#### EXT-007: Hot/Cold Memory Architecture
```yaml
id: EXT-007
priority: P1
complexity: L
dependencies: []
description: |
  Split memory into hot (in-RAM) and cold (SQLite) storage
  for sub-100ms retrieval while supporting large history.

hot_memory:
  episodic: "Last 50 interactions"
  semantic: "Top 100 patterns by confidence"
  skills: "Recently used procedures"
  max_size: "50MB"

cold_memory:
  storage: "SQLite database"
  location: ".autonomi/memory/memory.db"
  indexes: ["category", "confidence", "timestamp"]

consolidation:
  trigger: "Idle for 30 seconds"
  action: "Move stale hot to cold, prune old cold"

acceptance_criteria:
  - "Memory retrieval < 100ms p95"
  - "Hot memory < 50MB"
  - "Cold memory persists across sessions"
  - "Consolidation runs in background"

test_cases:
  - name: "retrieval_under_100ms"
    input: "Query semantic memory"
    expected: "Result within 100ms"
    validation: "Latency metric < 100"
```

### 3.5 MCP Integration

#### EXT-008: MCP Client Support
```yaml
id: EXT-008
priority: P1
complexity: L
dependencies: [EXT-004]
description: |
  Connect to Model Context Protocol servers to extend capabilities.

features:
  server_connection:
    - "Connect to local MCP servers"
    - "Connect to remote MCP servers (with auth)"
    - "Auto-discover available tools"

  tool_invocation:
    - "Agent can request MCP tool use"
    - "Results integrated into agent context"

  built_in_servers:
    - "File system (read/write with permissions)"
    - "Git operations"
    - "Terminal execution"

acceptance_criteria:
  - "Connect to MCP servers via stdio or SSE"
  - "Tool discovery lists available capabilities"
  - "Agents can invoke MCP tools"
  - "MCP errors handled gracefully"

test_cases:
  - name: "mcp_tool_invocation"
    input: "Use MCP tool to read file"
    expected: "File content returned"
    validation: "MCP call in execution log"
```

### 3.6 Cost Management

#### EXT-009: Cost Tracking and Budgets
```yaml
id: EXT-009
priority: P0
complexity: M
dependencies: []
description: |
  Track costs per-request, per-task, per-session.
  Configurable budgets with alerts and auto-pause.

tracking:
  per_request:
    - "Input tokens, output tokens, model"
    - "Cost calculation per provider pricing"

  per_task:
    - "Total requests, total tokens, total cost"
    - "Attribution to task ID"

  per_session:
    - "Running total since session start"
    - "Comparison to historical average"

budgets:
  task_budget:
    default: "$5.00"
    action: "pause_and_notify"
  session_budget:
    default: "$50.00"
    action: "pause_and_notify"
  daily_budget:
    default: "$100.00"
    action: "hard_stop"

acceptance_criteria:
  - "Cost displayed in real-time in status bar"
  - "Budget alerts trigger at 80% threshold"
  - "Budget exceeded pauses execution"
  - "Cost exportable for enterprise chargeback"

test_cases:
  - name: "budget_pause_on_exceed"
    input: "Task that exceeds $5 budget"
    expected: "Execution pauses, user notified"
    validation: "Budget exceeded event in log"
```

### 3.7 Workspace Snapshots

#### EXT-010: Snapshot and Restore
```yaml
id: EXT-010
priority: P1
complexity: M
dependencies: []
description: |
  Automatic workspace snapshots before changes.
  Visual diff comparison, one-click restore.

snapshots:
  trigger: "Before any file modification"
  storage: ".autonomi/snapshots/{timestamp}/"
  content: "Changed files only (not full workspace)"
  retention: "Last 20 snapshots"

operations:
  compare:
    - "Visual diff in WebView"
    - "File-by-file comparison"
  restore:
    - "One-click restore to snapshot"
    - "Selective file restore"
  export:
    - "Export snapshot as patch file"

acceptance_criteria:
  - "Snapshot taken before every modification"
  - "Diff viewable in UI"
  - "Restore works correctly"
  - "Old snapshots auto-pruned"

test_cases:
  - name: "restore_to_snapshot"
    input: "Restore to previous snapshot"
    expected: "Files reverted to snapshot state"
    validation: "File contents match snapshot"
```

### 3.8 Enterprise Features

#### EXT-011: SSO/SAML Integration
```yaml
id: EXT-011
priority: P1
complexity: L
dependencies: []
tier: "enterprise"
description: |
  Enterprise identity provider integration.

supported_providers:
  - "Azure AD / Entra ID"
  - "Okta"
  - "OneLogin"
  - "Generic SAML 2.0"
  - "Generic OIDC"

workflow:
  1_configure: "Admin configures IdP in central management"
  2_authenticate: "Extension redirects to IdP"
  3_token: "Receive JWT/SAML assertion"
  4_authorize: "Map IdP groups to Autonomi roles"

acceptance_criteria:
  - "SSO login flow works"
  - "IdP groups map to roles"
  - "Session timeout respected"
  - "Logout triggers IdP logout"

test_cases:
  - name: "sso_login_flow"
    input: "Click SSO login"
    expected: "Redirect to IdP, return authenticated"
    validation: "User context populated from IdP"
```

#### EXT-012: Audit Logging
```yaml
id: EXT-012
priority: P1
complexity: M
dependencies: []
tier: "enterprise"
description: |
  Immutable audit trail for compliance.

logged_events:
  - "Task started/completed/failed"
  - "Agent dispatched with prompt"
  - "File modified (before/after hash)"
  - "Approval gate triggered/resolved"
  - "Configuration changed"
  - "Cost incurred"

export_formats:
  - "JSON Lines (default)"
  - "CEF (for SIEM)"
  - "Splunk HEC"

retention:
  local: "30 days"
  export: "Configurable destination"

acceptance_criteria:
  - "All events logged with timestamp"
  - "Logs immutable (append-only)"
  - "Export to SIEM works"
  - "Retention policy enforced"

test_cases:
  - name: "audit_log_captures_all"
    input: "Complete task"
    expected: "All events in audit log"
    validation: "Event count matches expected"
```

#### EXT-013: Role-Based Access Control
```yaml
id: EXT-013
priority: P2
complexity: M
dependencies: [EXT-011]
tier: "enterprise"
description: |
  Granular permissions for team hierarchies.

roles:
  admin:
    - "Configure all settings"
    - "Access all agent types"
    - "Override all gates"
  developer:
    - "Use engineering agents"
    - "Approve own tasks"
    - "View own costs"
  viewer:
    - "View status only"
    - "Cannot execute tasks"

permissions:
  - "agent.{type}.execute"
  - "gate.{type}.override"
  - "cost.view_team"
  - "config.modify"

acceptance_criteria:
  - "Roles enforceable from central management"
  - "Permissions checked before action"
  - "Role changes take effect immediately"

test_cases:
  - name: "viewer_cannot_execute"
    input: "Viewer tries to run task"
    expected: "Permission denied"
    validation: "Error with role violation"
```

### 3.9 UI Components

#### EXT-014: TreeView Panel (Native)
```yaml
id: EXT-014
priority: P0
complexity: M
dependencies: [EXT-001]
description: |
  Always-visible native TreeView for status and queue.

sections:
  status:
    - "Current phase"
    - "Active agents (with type)"
    - "Confidence level"
    - "Session cost"

  queue:
    - "Pending tasks"
    - "In-progress (with progress indicator)"
    - "Recent completed"

  actions:
    - "Pause/Resume"
    - "View Plan"
    - "Open Dashboard"

acceptance_criteria:
  - "Updates within 1 second of state change"
  - "Minimal memory footprint"
  - "Click-to-expand details"
  - "Non-blocking"

test_cases:
  - name: "real_time_update"
    input: "Task status changes"
    expected: "TreeView updates < 1s"
    validation: "UI refresh timestamp"
```

#### EXT-015: WebView Dashboard (Lazy)
```yaml
id: EXT-015
priority: P2
complexity: L
dependencies: [EXT-014]
description: |
  Heavy dashboard loaded on demand, destroyed when hidden.

tabs:
  plan:
    - "Current execution plan"
    - "Approve/Modify buttons"
  artifacts:
    - "Generated reports"
    - "Architecture diagrams"
    - "Screenshots"
  memory:
    - "Browse episodic/semantic"
    - "Search patterns"
  metrics:
    - "Cost trends (chart)"
    - "Agent usage (pie)"
    - "Quality scores (line)"

acceptance_criteria:
  - "Loads on explicit user action"
  - "Destroyed when panel hidden"
  - "< 50MB additional memory"
  - "Communicates via postMessage"
```

#### EXT-016: Streaming Output
```yaml
id: EXT-016
priority: P1
complexity: M
dependencies: [EXT-014]
description: |
  Stream LLM output to UI in real-time.

streaming:
  source: "Provider SDK streaming APIs"
  display: "Output channel or WebView"
  thinking: "Show extended thinking blocks (Claude)"

acceptance_criteria:
  - "Tokens appear as generated"
  - "Thinking blocks formatted distinctly"
  - "User can interrupt streaming"

test_cases:
  - name: "streaming_visible"
    input: "Generate long response"
    expected: "Text appears incrementally"
    validation: "Multiple UI updates during generation"
```

---

## 4. Non-Functional Requirements

### 4.1 Performance (Realistic)

```yaml
id: EXT-NFR-001
category: performance
requirements:
  - metric: "Extension activation time"
    target: "< 3 seconds"
    strategy: "Lazy load agents, defer provider init"

  - metric: "Memory retrieval latency"
    target: "< 100ms p95"
    strategy: "Hot/cold split, SQLite indexes"

  - metric: "UI update latency"
    target: "< 1 second"
    strategy: "Debounced updates, virtualized lists"

  - metric: "Extension memory footprint"
    target: "< 150MB (200MB with WebView)"
    strategy: "Lazy loading, WebView destruction"
```

### 4.2 Reliability

```yaml
id: EXT-NFR-002
category: reliability
requirements:
  - metric: "Crash recovery"
    target: "Auto-resume within 30 seconds"
    strategy: "Periodic checkpoints to workspaceState"

  - metric: "Data persistence"
    target: "Zero data loss on crash"
    strategy: "Write-ahead logging for critical state"

  - metric: "Provider failover"
    target: "< 5 seconds to fallback provider"
    strategy: "Circuit breaker with health checks"
```

### 4.3 Security

```yaml
id: EXT-NFR-003
category: security
requirements:
  - metric: "API key storage"
    target: "VSCode SecretStorage only"

  - metric: "Secret detection"
    target: "99% of known patterns (not 100%)"
    strategy: "gitleaks, trufflehog"

  - metric: "Telemetry"
    target: "Opt-in only, anonymized"

  - metric: "Air-gap support"
    target: "Full functionality with local models"
```

### 4.4 Compatibility

```yaml
id: EXT-NFR-004
category: compatibility
requirements:
  - metric: "VSCode version"
    target: ">= 1.85.0"

  - metric: "Cursor/Windsurf/Kiro"
    target: "Standard Extension API subset"
    note: "Proprietary APIs not supported"

  - metric: "Languages (Tier 1)"
    target: "TypeScript, JavaScript, Python, Go, Rust, Java"

  - metric: "Languages (Tier 2)"
    target: "C#, Ruby, PHP, Swift, Kotlin"
```

---

## 5. Pricing Model

### 5.1 Tiers

```yaml
free:
  name: "Autonomi Free"
  price: "$0"
  features:
    - "Single provider (Anthropic OR OpenAI OR Google)"
    - "5 agent types (frontend, backend, code-review, docs, refactor)"
    - "Basic memory (session only)"
    - "Community support"
  limits:
    - "100 tasks/month"
    - "No enterprise features"

pro:
  name: "Autonomi Pro"
  price: "$39/seat/month"
  features:
    - "All providers"
    - "All 15 agent types"
    - "Persistent memory"
    - "MCP integration"
    - "Workspace snapshots"
    - "Email support"
  limits:
    - "Unlimited tasks"
    - "Bring your own API keys"

enterprise:
  name: "Autonomi Enterprise"
  price: "$99/seat/month (min 10 seats)"
  features:
    - "Everything in Pro"
    - "SSO/SAML"
    - "Audit logging + SIEM export"
    - "RBAC"
    - "Central management console"
    - "Org-level cost controls"
    - "Dedicated support + SLA"
    - "Air-gap deployment option"
  add_ons:
    - "Professional services: Custom integration"
    - "Training: Team onboarding"
```

### 5.2 Cost Model

```yaml
api_costs:
  model: "Pass-through (user pays provider directly)"
  benefit: "No markup, transparent"
  guidance: "Cost calculator in UI"

optimization:
  strategy: "Haiku for Tier 1, Sonnet for Tier 2-3, Opus for planning only"
  expected_savings: "40-60% vs naive Opus-for-everything"
```

---

## 6. Implementation Phases

### Phase 0: MVP (Weeks 1-6)
```yaml
requirements: [EXT-001, EXT-002, EXT-005, EXT-009, EXT-014]
deliverable: "Working RARV cycle with plan mode, single provider, cost tracking"
validation: "Complete simple task with plan approval"
```

### Phase 1: Multi-Agent (Weeks 7-12)
```yaml
requirements: [EXT-003, EXT-004, EXT-006]
deliverable: "15 agent types with configurable gates and quality pipeline"
validation: "Complex multi-file task completes correctly"
```

### Phase 2: Memory & MCP (Weeks 13-16)
```yaml
requirements: [EXT-007, EXT-008, EXT-010]
deliverable: "Persistent memory, MCP integration, snapshots"
validation: "Pattern learned in session 1, used in session 2"
```

### Phase 3: Enterprise (Weeks 17-22)
```yaml
requirements: [EXT-011, EXT-012, EXT-013, EXT-015, EXT-016]
deliverable: "Full enterprise features, polished UI"
validation: "SOC2 controls checklist passes"
```

---

## 7. Success Metrics (Measurable)

```yaml
adoption:
  - "5,000 installs in first month"
  - "4.0+ star rating"
  - "< 10% uninstall rate"

quality:
  - "Average 2.1 prompts per task (measure via telemetry)"
  - "< 15% task failure rate"
  - "25% reduction in time-to-merge (A/B test)"

performance:
  - "SWE-bench-lite: > 35% resolution rate"
  - "HumanEval: > 85% pass@1"
  - "Memory retrieval < 100ms p95"

enterprise:
  - "3 design partners by month 3"
  - "First enterprise contract by month 6"
  - "$500K ARR by month 12"
```

---

## 8. Risks and Mitigations

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Provider API changes | Medium | High | Abstract provider layer, version pinning |
| Rate limiting | High | Medium | Multi-provider fallback, circuit breakers |
| Enterprise sales cycle | High | High | Design partners, case studies |
| Competitor feature match | High | Medium | Focus on enterprise differentiation |
| Cost concerns | Medium | High | Aggressive optimization, transparent tracking |

---

## 9. Appendix: Research References

| Pattern | Source | Internal Use Only |
|---------|--------|-------------------|
| Constitutional AI | Anthropic | Agent self-critique |
| CONSENSAGENT | Academic 2025 | Review aggregation |
| ReAct | Academic 2023 | RARV foundation |
| SWE-bench | Academic 2024 | Benchmark validation |
| HumanEval | OpenAI | Benchmark validation |

---

**Document Version:** 2.0.0 (Post-Feedback)
**Feedback Loops:** 3 Opus iterations
**Changes from v1:** Reduced agents (37->15), added plan mode, added enterprise features, added pricing, fixed unrealistic claims, added MCP support, added cost tracking
