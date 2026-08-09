#!/usr/bin/env bash
# .env.local をローカル Supabase スタックの接続情報から生成する。
# 既存の .env.local があれば何もしない (手動設定を上書きしないため)。
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -f .env.local ]; then
    echo ".env.local already exists; skipping generation"
    exit 0
fi

# supabase status -o env は KEY="value" 形式で接続情報を出力する
status_env=$(npx -y supabase@latest status -o env 2>/dev/null) || {
    echo "error: local Supabase stack is not running. Run 'make db-start' first." >&2
    exit 1
}

get() {
    echo "$status_env" | grep "^$1=" | head -1 | cut -d= -f2- | tr -d '"'
}

SUPABASE_URL=$(get API_URL)
SUPABASE_PUBLISHABLE_KEY=$(get PUBLISHABLE_KEY)
SUPABASE_SECRET_KEY=$(get SECRET_KEY)
SUPABASE_JWT_SECRET=$(get JWT_SECRET)
AUTH_SECRET=$(openssl rand -base64 33)

if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_JWT_SECRET" ]; then
    echo "error: could not extract connection info from 'supabase status'" >&2
    exit 1
fi

cat > .env.local <<EOF
# ローカル開発用の環境変数 (scripts/setup-env-local.sh が生成)
# 変数の意味は .env.example と docs/auth-design.md §8 を参照

# --- Supabase (ローカルスタックの値) ---
SUPABASE_URL=$SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY=$SUPABASE_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY=$SUPABASE_SECRET_KEY
SUPABASE_JWT_SECRET=$SUPABASE_JWT_SECRET

# --- Auth.js ---
AUTH_SECRET=$AUTH_SECRET

# GitHub ログインに必要 (docs/github-oauth-setup.md の手順で OAuth App を作成後、
# コメントを外して実値を設定する。コメントのままなら未設定として扱われる)
#AUTH_GITHUB_ID=
#AUTH_GITHUB_SECRET=
EOF

echo "generated: .env.local"
echo "note: set AUTH_GITHUB_ID / AUTH_GITHUB_SECRET to enable GitHub login (docs/github-oauth-setup.md)"
