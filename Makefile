# dagdo 集約 Makefile
#
# サブプロジェクト:
#   fe-* : Next.js アプリ (リポジトリルート、Node 22 は .node-version で固定)
#   db-* : Supabase (supabase/ 配下。CLI は npx 経由で実行)
#
# `make help` でターゲット一覧を表示する。
# 各ターゲットの説明はターゲット行末尾の `## 説明` を help が抽出する。

SUPABASE := npx -y supabase@latest

.DEFAULT_GOAL := help

.PHONY: help
help: ## ターゲット一覧を表示する
	@awk 'BEGIN {FS = ":.*## "; printf "\nUsage: make <target>\n\n"} /^[a-zA-Z0-9_-]+:.*## / {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2} /^##@/ {printf "\n\033[1m%s\033[0m\n", substr($$0, 5)}' $(MAKEFILE_LIST)
	@echo ""

##@ セットアップ

.PHONY: setup
setup: ## 初回セットアップ (依存インストール + DB 起動 + reset + 型生成 + .env.local 生成)
	npm install
	$(MAKE) db-start
	$(MAKE) db-reset
	$(MAKE) db-types
	$(MAKE) env-local

.PHONY: env-local
env-local: ## .env.local をローカル Supabase の接続情報から生成する (既存なら何もしない)
	bash scripts/setup-env-local.sh

##@ Frontend (Next.js)

.PHONY: fe-dev
fe-dev: ## 開発サーバーを起動する
	npm run dev

.PHONY: fe-build
fe-build: ## 本番ビルドを実行する
	npm run build

.PHONY: fe-check
fe-check: ## 品質ゲート (biome + tsc + knip) を実行する
	npm run check

.PHONY: fe-test
fe-test: ## 単体テスト (vitest) を実行する
	npm test

.PHONY: fe-format
fe-format: ## biome で整形する
	npm run format

##@ Database (Supabase)

.PHONY: db-start
db-start: ## ローカル Supabase スタックを起動する
	$(SUPABASE) start

.PHONY: db-stop
db-stop: ## ローカル Supabase スタックを停止する
	$(SUPABASE) stop

.PHONY: db-status
db-status: ## ローカル Supabase の稼働状態と接続情報を表示する
	$(SUPABASE) status

.PHONY: db-reset
db-reset: ## ローカル DB を再構築する (migration + seed を空 DB から適用)
	$(SUPABASE) db reset

.PHONY: db-test
db-test: ## pgTAP テストを実行する (supabase/tests/)
	$(SUPABASE) test db

.PHONY: db-types
db-types: ## DB 型を再生成する (src/lib/supabase/database.types.ts)
	$(SUPABASE) gen types typescript --local > src/lib/supabase/database.types.ts
	@echo "generated: src/lib/supabase/database.types.ts"

.PHONY: db-push
db-push: ## migration を hosted Supabase へ反映する (要 supabase link。seed は適用されない)
	$(SUPABASE) db push

##@ 複合

.PHONY: check
# fe-build を先頭に置くのは、tsc が Next.js の生成する型に依存するためである。
# src/app/layout.tsx の LayoutProps は .next/types/routes.d.ts に生成されるグローバル型で、
# tsconfig.json の include が .next/types/**/*.ts を拾って解決している。
# make setup はビルドを含まないため、fe-build を挟まないと clone 直後の fe-check が
# TS2304 (Cannot find name 'LayoutProps') で落ちる (Issue #40)。
check: fe-build fe-check fe-test db-test ## 全品質ゲート (fe-build + fe-check + fe-test + db-test) を実行する
