# Changelog

## v0.0.15 (2026-04-07)
### Fixes
- Force the model to get langfuse host from env

### Other
- Merge pull request #168 from Not-Diamond/d3-skip-tmp-dirs
- Reports and traces are written directly to destination directories, not tmp
- Revert "remove default langfuse host"
- remove default langfuse host
- Add permission to run check-env
- Check and prompt for langfuse_base_url

## v0.0.14 (2026-04-07)
Initial release.

## v0.0.13 (2026-04-07)
### Fixes
- add telemetry script handling in prepare-release.sh

## v0.0.12 (2026-04-07)
### Fixes
- add agent tool paths to sanitize-patterns.json and update bundling in prepare-release.sh

## v0.0.11 (2026-04-07)
### Fixes
- update plugin source path in marketplace.json and adjust prepare-release.sh for staging directory

## v0.0.10 (2026-04-07)
### Fixes
- make plugin scripts executable during release preparation

## v0.0.9 (2026-04-07)
### Fixes
- update CLI path replacements in sanitize-patterns.json to use CLAUDE_PLUGIN_ROOT

## v0.0.8 (2026-04-07)
### Fixes
- update CLI path replacements in sanitize-patterns.json to include 'plugin/' prefix

## v0.0.7 (2026-04-07)
### Fixes
- update plugin source path in marketplace.json and adjust release script for new directory structure

## v0.0.6 (2026-04-07)
### Fixes
- add source field to plugin manifest and remove obsolete copy script

## v0.0.5 (2026-04-07)
### Fixes
- remove source information from marketplace.json

## v0.0.4 (2026-04-07)
### Features
- add source_url_base to traces and related components for LangSmith integration

### Fixes
- update plugin version in JSON files during release preparation

## v0.0.3 (2026-04-06)
Initial release.

## v0.0.2 (2026-04-06)
### Features
- add auto-remediation section to README with detailed workflow and examples
- add continuous monitoring feature with autosync commands in README
- add templates for issue reporting, feature requests, and pull requests; enhance README and CONTRIBUTING files; implement security and code of conduct guidelines
- add marketplace.json for plugin metadata and update release script to include it
- add README and CONTRIBUTING templates for OSS repo
- add prepare-release.sh for OSS release pipeline
- add content sanitization patterns for OSS release
- add esbuild bundle script for trace-importer CLIs
- move trace-importer sources into packages/core
- scaffold packages/core with sme-shared sources
- Add review command and save report data as JSON sidecar
- Update run command for changes in workflow
- prompt for consent during init as well
- add script for sending telemetry to posthog
- changed target to .spec-vector/config.json
- generate_report.sh includes source URL in report and terminal output
- report-generator accepts optional sourceUrl field
- run.md uses ephemeral temp file and threads source_url to report
- add remote trace source to /self-care:run
- add /self-care:init slash command

### Fixes
- refactor paths to use core module instead of trace-importer across various files
- Correct location for agent skill scripts
- update imports to use trace-importer module in services
- improve regex for internal notdiamond subdomains in sanitize patterns
- add check for existing skill agent files before copying
- update import path for LangSmithRun type to use relative path
- add autosync CLI entry point and update sanitize patterns for autosync paths
- remove error handling for bundling process in bundle.mjs
- enhance prepare-release script to accept existing changelog path; update release workflow to use new parameter
- update changelog extraction logic in release workflow; modify marketplace.json structure and versioning in prepare-release script
- improve tag creation logic in release workflow; sanitize temporary files in prepare-release script; update README installation command
- update regex for internal email addresses to exclude support@; improve changelog entry formatting in prepare-release.sh
- update git log commands in prepare-release.sh to exclude unnecessary packages; improve file sync process in release-oss.yml
- use Notification hook for autosync alerts instead of inline osascript
- align autosync-tick analyzer invocation with run command
- use basename for project identifier in cron prompt
- move all runtime state from global ~/.self-care/ to local .self-care/
- update email address for reporting security vulnerabilities in SECURITY.md; remove unused reports directory in prepare-release.sh
- move autosync runtime from memory/self-care/ to memory/autosync/
- PR issue found by SpecVector
- copy check-env.sh and add sanitization pattern for its path
- reference update
- update telemetry references to analytics in review and run commands
- PR feedback
- update report paths and improve documentation for review command
- update permissions for generate_report script
- align to run changes
- report generation
- update comment
- PR feedback - no bypassing of consent, fix invalid json
- update init.md to preserve anonymous_id during config write
- ensure config directory exists before writing merged config
- update analytics consent prompt message in config documentation
- address feedback
- init changes
- otel validator fix and langfuse
- env lookup and wrong script

### Other
- Merge branch 'main' into prepare-oss-release
- Merge origin/main into eng-4678-update-run-flow-simplify-remediation-step
- Merge branch 'main' into prepare-oss-release
- Merge branch 'main' into e4-cc-autosync
- enhance CONTRIBUTING.md with detailed sections for bug reports, feature requests, and pull requests
- desktop notification in autosync-tick when cases are found
- auto_analyze config — autosync always analyzes new traces
- update prepare-release.sh file permissions to executable
- Update packages/self-care-plugin/agents/skills/scripts/generate_report.sh
- Update help
- Update report generation skill and script to use review status and outcomes
- use analytics.enabled instead
- Update packages/self-care-plugin/commands/config.md
- align plugin storage paths with review feedback
- plugin autosync commands and local self-care paths
- Merge branch 'main' into d3-user-consent
- remove trace-validator.md agent
- plugin commands use deterministic validator CLI
- init.md no longer creates .self-care/traces/ directories
- User gets requested for consent on first /run call
- update help command with init and remote trace support
- migrate self-care-reports/ to .self-care/reports/
- update skills, add prechecks for parts of the skill that can be deteministic, convert deterministic skills to tools
- addressed feedback
- Merge branch 'd3-remove-supabase' into ENG-4601_move-claude-code-related-into-separate-package
- moved scripts into cc plugin
- move CC plugin files into packages/self-care-plugin/

## v0.0.1 (2026-04-06)
### Features
- add templates for issue reporting, feature requests, and pull requests; enhance README and CONTRIBUTING files; implement security and code of conduct guidelines
- add marketplace.json for plugin metadata and update release script to include it
- add README and CONTRIBUTING templates for OSS repo
- add prepare-release.sh for OSS release pipeline
- add content sanitization patterns for OSS release
- add esbuild bundle script for trace-importer CLIs
- move trace-importer sources into packages/core
- scaffold packages/core with sme-shared sources
- prompt for consent during init as well
- add script for sending telemetry to posthog
- changed target to .spec-vector/config.json
- generate_report.sh includes source URL in report and terminal output
- report-generator accepts optional sourceUrl field
- run.md uses ephemeral temp file and threads source_url to report
- add remote trace source to /self-care:run
- add /self-care:init slash command

### Fixes
- update imports to use trace-importer module in services
- improve regex for internal notdiamond subdomains in sanitize patterns
- add check for existing skill agent files before copying
- update import path for LangSmithRun type to use relative path
- add autosync CLI entry point and update sanitize patterns for autosync paths
- remove error handling for bundling process in bundle.mjs
- enhance prepare-release script to accept existing changelog path; update release workflow to use new parameter
- update changelog extraction logic in release workflow; modify marketplace.json structure and versioning in prepare-release script
- improve tag creation logic in release workflow; sanitize temporary files in prepare-release script; update README installation command
- update regex for internal email addresses to exclude support@; improve changelog entry formatting in prepare-release.sh
- update git log commands in prepare-release.sh to exclude unnecessary packages; improve file sync process in release-oss.yml
- use Notification hook for autosync alerts instead of inline osascript
- align autosync-tick analyzer invocation with run command
- use basename for project identifier in cron prompt
- move all runtime state from global ~/.self-care/ to local .self-care/
- update email address for reporting security vulnerabilities in SECURITY.md; remove unused reports directory in prepare-release.sh
- move autosync runtime from memory/self-care/ to memory/autosync/
- PR issue found by SpecVector
- copy check-env.sh and add sanitization pattern for its path
- update comment
- PR feedback - no bypassing of consent, fix invalid json
- update init.md to preserve anonymous_id during config write
- ensure config directory exists before writing merged config
- update analytics consent prompt message in config documentation
- address feedback
- init changes
- otel validator fix and langfuse
- env lookup and wrong script

### Other
- Merge branch 'main' into prepare-oss-release
- Merge branch 'main' into e4-cc-autosync
- enhance CONTRIBUTING.md with detailed sections for bug reports, feature requests, and pull requests
- desktop notification in autosync-tick when cases are found
- auto_analyze config — autosync always analyzes new traces
- update prepare-release.sh file permissions to executable
- use analytics.enabled instead
- Update packages/self-care-plugin/commands/config.md
- align plugin storage paths with review feedback
- plugin autosync commands and local self-care paths
- Merge branch 'main' into d3-user-consent
- remove trace-validator.md agent
- plugin commands use deterministic validator CLI
- init.md no longer creates .self-care/traces/ directories
- User gets requested for consent on first /run call
- update help command with init and remote trace support
- migrate self-care-reports/ to .self-care/reports/
- update skills, add prechecks for parts of the skill that can be deteministic, convert deterministic skills to tools
- addressed feedback
- Merge branch 'd3-remove-supabase' into ENG-4601_move-claude-code-related-into-separate-package
- moved scripts into cc plugin
- move CC plugin files into packages/self-care-plugin/
