# SillyTavern Character Tools (extension) — dev tasks.
# The extension ships as raw browser ES modules; this tooling is dev-only
# (SillyTavern loads only what manifest.json lists, never package.json).

.DEFAULT_GOAL := help
.PHONY: help install lint lint-fix test test-watch check clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

install: ## Install dev dependencies (reproducible, from package-lock.json)
	npm ci

lint: ## Run ESLint
	npm run lint

lint-fix: ## Run ESLint with --fix
	npm run lint:fix

test: ## Run the unit tests once
	npm test

test-watch: ## Run the unit tests in watch mode
	npm run test:watch

check: lint test ## Full local gate: lint + tests (what CI runs)

clean: ## Remove installed dependencies and coverage output
	rm -rf node_modules coverage
