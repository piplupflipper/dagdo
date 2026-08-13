# dagdo DB設計書

対象リポジトリ: dagdo
対象コミット: 2752573
作成日: 2026-08-08
更新日: 2026-08-13
生成者: Claude Code

本文書は `req.md` （Todo Application 詳細設計書、対象コミット 90c9c84 時点）の記載を根拠とする。
本文中の `(req.md §NN)` はその節番号を指す。
`req.md` は本リポジトリ直下に存在する `req.md:1` から参照できる。

## 1. サマリ

dagdoは個人利用を主目的としたWebベースのTodoアプリケーションである(req.md §1)。

タスクは通常のTodo管理に加えて、親子関係と依存関係という2種類のタスク間関係を扱う(req.md §1)。

データベースにはSupabase PostgreSQLを使用し、専用APIサーバーを持たずNext.js Server ActionsからSupabaseへ直接アクセスする(req.md §1)。

本文書は`req.md`が定めるDB設計（スキーマ、状態モデル、親子関係、依存関係、論理削除、並び順、View、RLS、Trigger、RPC、認証構成、エラー契約、インデックス方針）を、読み物として通る構造に再編したものである。

`req.md`自体が確定設計であり、本文書はその内容を体系化して説明するものであって、新しい設計判断を追加するものではない。

DB設計の骨子は次の3点に要約できる。

第一に、DBを「信頼できる状態」に保つという方針である(req.md §75)。

親子cycle、依存cycle、他ユーザーのタスクとの関連付け、blocked状態での完了といった不正状態は、Server Actionの実装を経由しなくてもConstraintとTriggerが拒否する(req.md §75)。

第二に、`is_blocked`、`effective_parent_id`、`sort_path`という3つの派生値をテーブルへ保存せず、Viewやアプリケーション側で都度算出する方針である(req.md §75)。

第三に、論理削除によって親子関係や依存関係の構造情報を失わないという方針である(req.md §75)。

削除済みノードは通常操作上は透明化されるが、`parent_id`や`task_dependencies`レコードそのものは保持され、復元によって元の構造がそのまま蘇る(req.md §21, §23, §24)。

フロントエンドの実装詳細（画面構成、コンポーネント設計、状態管理など）は本文書の対象外とする。

それらは別文書`docs/frontend-design.md`に委ねる。

## 目次

- [2. 全体アーキテクチャと責務分割](#2-全体アーキテクチャと責務分割)
- [3. テーブル設計](#3-テーブル設計)
- [4. タスクの状態モデル](#4-タスクの状態モデル)
- [5. 親子関係](#5-親子関係)
- [6. 依存関係](#6-依存関係)
- [7. 論理削除、ゴミ箱、完全削除](#7-論理削除ゴミ箱完全削除)
- [8. 並び順](#8-並び順)
- [9. app_tasks View](#9-app_tasks-view)
- [10. RLS](#10-rls)
- [11. Trigger](#11-trigger)
- [12. RPC](#12-rpc)
- [13. 認証](#13-認証)
- [14. エラー契約](#14-エラー契約)
- [15. インデックス方針、一覧取得、同時実行の割り切り](#15-インデックス方針一覧取得同時実行の割り切り)
- [16. V1の設計原則](#16-v1の設計原則)
- [17. 用語集](#17-用語集)

## 2. 全体アーキテクチャと責務分割

dagdoの技術構成は、アプリケーション側がNext.js、TypeScript、Server Actions、Vercelであり、データベース側がSupabase、PostgreSQL、Supabase Data API、PostgreSQL RLS、PostgreSQL View、PostgreSQL Trigger、PostgreSQL Function（Supabase RPC経由）である(req.md §2.1, §2.2)。

書き込み経路の責務は次のように整理されている(req.md §71)。

```text
Browser
   ↓

Next.js UI
   ↓

Server Action
- session確認
- 入力validation
- DB/RPC呼び出し
- DBエラー変換
- revalidation
   ↓

Supabase Data API
   ↓

PostgreSQL RPC
- 複合操作
- transaction
   ↓

Constraint / RLS / Trigger
- 最終的なデータ整合性
   ↓

Tables
```

読み取り経路は次の通りである(req.md §71)。

```text
Server Component / Server Action
   ↓
app_tasks View
   ↓
tasks / task_dependencies
```

この2つの経路から導かれる原則は、データ整合性の最終防衛線が常にDB側（Constraint、RLS、Trigger）にあり、Server ActionやRPCはそれを補助する層だという点である。

各層の責務はさらに次のように細分される(req.md §51)。

**Constraint**：単純で常に成立すべき構造的ルールを保証する層である。

NOT NULL、外部キー（以下FK）、UNIQUE、CHECK、同一ユーザーであることの保証、自己依存の禁止がこれに含まれる(req.md §51)。

**Trigger**：どの経路からDBを書き換えても破られてはいけない不変条件を保証する層である。

cycle禁止とblocked completion禁止がこれに含まれる(req.md §51)。

**RPC**：複数行更新や複数操作を1トランザクションとして扱う層である。

move、reorder、restore、permanent deleteがこれに含まれる(req.md §51)。

**Server Action**：Webアプリケーションとしてのユースケース境界を担当する層である(req.md §51)。

Triggerには「どの経路からDBを書き換えても破られてはいけない不変条件」だけを持たせ、複数行にまたがる操作はRPCへ分離する、という役割分担が徹底されている(req.md §47, §51)。

したがって、cycle検出のような不変条件はTrigger側を正とし、RPC側が同じロジックを重複実装することはしない(req.md §53)。

## 3. テーブル設計

dagdoのDB設計は`tasks`テーブルと`task_dependencies`テーブルの2つを中心に構成される。

利用者は個人利用を主用途とするが、複数ユーザーが利用してもデータが混在しないよう、RLSと`user_id`付きのFK制約の両方でユーザー単位の分離を保証する方針である(req.md §3.1)。

GitHub OAuthログイン後に特定アカウントだけを許可するallowlistは設けない(req.md §3.1)。

### 3.1 tasksテーブル

`tasks`テーブルの基本スキーマは次の通りである(req.md §37)。

```sql
create table public.tasks (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null,

  title text not null,
  description text not null default '',

  parent_id uuid,

  position integer not null default 0,

  due_date date,

  completed_at timestamptz,
  deleted_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint tasks_title_not_blank
    check (length(btrim(title)) > 0),

  constraint tasks_position_non_negative
    check (position >= 0),

  constraint tasks_not_own_parent
    check (parent_id is null or parent_id <> id),

  constraint tasks_user_fkey
    foreign key (user_id)
    references next_auth.users(id),

  constraint tasks_user_id_id_unique
    unique (user_id, id),

  constraint tasks_parent_same_user_fkey
    foreign key (user_id, parent_id)
    references public.tasks(user_id, id)
);
```

各カラムの意味は次の通りである(req.md §4)。

| 項目 | 必須 | 説明 |
| --- | --- | --- |
| id | Yes | UUID |
| user_id | Yes | 所有ユーザー |
| title | Yes | タイトル |
| description | Yes | Markdown対応。空文字可 |
| parent_id | No | 親タスク |
| position | Yes | actual sibling内での並び順 |
| due_date | No | 期日。日付のみ |
| completed_at | No | 完了日時 |
| deleted_at | No | 論理削除日時 |
| created_at | Yes | 作成日時 |
| updated_at | Yes | 更新日時 |

タスクは完了状態専用のboolean カラムを持たない(req.md §4)。

完了と未完了は`completed_at`の有無だけで表現する(req.md §4)。

`due_date`は日時ではなく日付のみを扱い、`date`型かつNULL許容である(req.md §6)。

アプリケーションの基準タイムゾーンはAsia/Tokyoであり、`due_date`自体はタイムゾーン非依存だが、今日か期限切れかの判定や`completed_at`、`created_at`の表示ではAsia/Tokyoを基準とする(req.md §6)。

`description`はMarkdownのソース文字列をそのまま保存し、リッチテキスト形式はV1では採用しない(req.md §7)。

各制約の意図は次の通りである。

`tasks_title_not_blank`は、空白のみのタイトルを許容しないためのCHECK制約である(req.md §37)。

`tasks_position_non_negative`は、`position`が負値を取らないことを保証する(req.md §37)。

`tasks_not_own_parent`は、自分自身を親にすること（`A.parent_id = A.id`）を防ぐ(req.md §8, §37)。

`tasks_user_fkey`は、`user_id`が`next_auth.users(id)`を参照することを保証する(req.md §32, §37)。

`tasks_user_id_id_unique`は、`(user_id, id)`の組に対するUNIQUE制約であり、後続の`tasks_parent_same_user_fkey`が複合FKとして成立するために必要な前提である(req.md §37)。

`tasks_parent_same_user_fkey`は、`(user_id, parent_id)`が`tasks(user_id, id)`を参照する複合FKである(req.md §37)。

この制約により、親タスクの`user_id`と子タスクの`user_id`が一致することがDBレベルで強制される。

つまり、異なるユーザーのタスクを親子関係で接続することは、RLSを経由せずともFK制約自体が拒否する(req.md §39)。

### 3.2 task_dependenciesテーブル

`task_dependencies`テーブルのスキーマは次の通りである(req.md §38)。

```sql
create table public.task_dependencies (
  user_id uuid not null,
  task_id uuid not null,
  depends_on_task_id uuid not null,

  created_at timestamptz not null default now(),

  primary key (
    user_id,
    task_id,
    depends_on_task_id
  ),

  constraint task_dependency_not_self
    check (task_id <> depends_on_task_id),

  constraint task_dependency_task_fkey
    foreign key (user_id, task_id)
    references public.tasks(user_id, id)
    on delete cascade,

  constraint task_dependency_depends_on_fkey
    foreign key (user_id, depends_on_task_id)
    references public.tasks(user_id, id)
    on delete cascade
);
```

主キーが`(user_id, task_id, depends_on_task_id)`の複合キーであるため、同一の依存edgeを重複登録することはできない(req.md §38)。

`task_dependency_not_self`は、自分自身への依存（`task_id = depends_on_task_id`）を防ぐCHECK制約である(req.md §10, §38)。

`task_dependency_task_fkey`と`task_dependency_depends_on_fkey`は、いずれも`(user_id, task_id)`または`(user_id, depends_on_task_id)`から`tasks(user_id, id)`への複合FKである。

`tasks_parent_same_user_fkey`と同じ理由により、依存関係についても異なるユーザーのタスク同士を接続することをDBレベルで拒否する(req.md §39)。

両FKには`on delete cascade`が指定されている(req.md §38)。

これは物理削除（完全削除）時に依存edgeを個別に消す手間を減らすための指定であり、通常の論理削除では`tasks`テーブル自体がDELETEされないため発動しない。

なお、完全削除RPCである`permanently_delete_task`は、対象タスクに接続していた依存edgeの削除をRPC内の処理としても明示している(req.md §27, §57)。

`tasks`テーブルと`task_dependencies`テーブルは、いずれも複合FKによってユーザー単位の分離をデータ構造そのもので保証している(req.md §39)。

異なるユーザーのタスクへ親を設定すること、異なるユーザーのタスクへ依存を張ることは、RLSが機能しない状況でも構造的に成立しない。

## 4. タスクの状態モデル

タスクの状態は、DBに保存される`completed_at`と`deleted_at`の組み合わせと、DBに保存されず動的に算出される`blocked`によって表現される。

### 4.1 未完了、完了、削除済み

DBに保存する状態は主に次の3つで表現する(req.md §5)。

```text
未完了
completed_at IS NULL
deleted_at IS NULL

完了
completed_at IS NOT NULL
deleted_at IS NULL

削除済み
deleted_at IS NOT NULL
```

完了状態は`completed_at`の有無のみで表現し、専用のboolean カラムは持たない(req.md §4)。

削除済み状態は`deleted_at`の有無で表現し、`completed_at`の値とは独立である。

したがって、完了済みかつ削除済みという組み合わせも状態としてありうる。

完了済みタスクは、title、description、due_date、parent、position、dependencyのすべてを完了後も編集可能である(req.md §15)。

つまり、`completed_at`の有無は編集可否を制約しない。

### 4.2 blocked

`blocked`はDBの列として保存せず、依存関係から動的に算出する(req.md §5, §12)。

blockedの定義は、未完了かつ未削除の依存先が1件以上存在する未完了タスクである(req.md §12)。

概念的には次の通りである(req.md §12)。

```text
is_blocked =
    completed_at IS NULL
    AND
    未完了かつ未削除のdependencyが存在する
```

依存先タスクが完了すると、依存元タスクのblocked状態は解除される(req.md §12)。

`is_blocked`は未完了タスクについてのみ意味を持つ(req.md §14)。

完了済みタスクに対して`is_blocked`を評価する必要はなく、完了済みタスクを再オープンした結果として一時的に依存関係を満たさない状態になっても、それは`is_blocked`の対象ではなく再オープン後に改めて評価される未完了タスクの話になる。

blocked中の未完了タスクを完了することはDBレベルで禁止される(req.md §13)。

```text
A → B

A = todo
B = todo

B.complete()
→ TASK_BLOCKED
```

この保証はTrigger（blocked Completion Trigger）が担う(req.md §50)。詳細は11章で述べる。

## 5. 親子関係

タスクの親子関係は`tasks.parent_id`によって表現される。

### 5.1 forest構造とcycle禁止

1タスクにつき親は最大1つであり、複数階層を許可する(req.md §8)。

```text
Project A
├─ Task A
├─ Task B
│  └─ Task C
└─ Task D
```

親子関係は**forest**（森）構造とし、循環は禁止する(req.md §8)。

```text
A
└─ B
   └─ C
      └─ A
```

このような循環は禁止される。

自分自身を親にすること（`A.parent_id = A.id`）も禁止する(req.md §8)。

この自己参照の禁止は`tasks_not_own_parent`というCHECK制約でDBレベルに落とし込まれている(req.md §37)。

一方、複数階層にまたがるcycleの禁止はCHECK制約だけでは表現できない。

これは親子cycle Trigger（11章）がrecursive CTE（再帰的共通テーブル式）で祖先を辿ることによって保証される(req.md §48)。

### 5.2 完了の独立性

親と子の完了状態は独立である(req.md §9)。

子タスクがすべて完了しても親タスクを自動完了しない。

未完了の子タスクが存在していても親タスクを完了可能である(req.md §9)。

```text
☑ Project A
  ☑ Task A
  □ Task B
```

この状態を許容する(req.md §9)。

## 6. 依存関係

タスクの依存関係は`task_dependencies`テーブルによって表現される。

### 6.1 DAGとcycle禁止

タスク間に前後関係や依存関係を設定できる(req.md §10)。

1タスクが複数タスクへ依存でき、また1タスクを複数タスクが依存できる(req.md §10)。

```text
A ─┐
   ├→ C
B ─┘
```

この場合、CはAとBの両方に依存する(req.md §10)。

依存関係は**DAG**（Directed Acyclic Graph、有向非巡回グラフ）とする(req.md §10)。

```text
A → B → C → A
```

このような循環は禁止する。

自分自身への依存も禁止する(req.md §10)。

DAG全体にまたがるcycleの禁止は、CHECK制約ではなくDependency Cycle Trigger（11章）がrecursive CTEで判定する(req.md §49)。

### 6.2 親子関係との独立性

親子関係と依存関係は完全に独立した概念である(req.md §11)。

```text
Project
├─ DB設計
├─ API実装
└─ UI実装
```

という親子関係とは別に、

```text
DB設計 → API実装 → UI実装
```

という依存関係を設定できる(req.md §11)。

`parent_id`から依存関係を推論せず、逆に依存関係から親子関係を推論することもしない(req.md §11)。

positionが表す並び順についても同様であり、同一parentを持つタスク間の順序を意味するのみで、依存関係の順序とは完全に独立する(req.md §17)。

### 6.3 再オープンの扱い

完了済みタスクは未完了へ戻せる(req.md §14)。

```text
A → B
```

でAとBがともに完了している状態からAだけを再オープンしても、Bを自動的に再オープンしない(req.md §14)。

```text
A = todo
B = done
```

という状態を許容する(req.md §14)。

依存関係は「未完了タスクをこれから完了してよいか」を制約するものであり、過去の完了実績を巻き戻すものではない(req.md §14)。

したがって、reopenTask（Server Action、13章参照）は依存している他の完了済みタスクを変更しない(req.md §63)。

## 7. 論理削除、ゴミ箱、完全削除

削除は論理削除と完全削除（物理削除）の2段階で構成される。

### 7.1 論理削除

通常の削除では物理削除せず、`deleted_at timestamptz`カラムに削除時刻を記録する(req.md §19)。

```text
deleted_at = now()
```

削除済みタスクは通常画面と通常検索から除外する(req.md §19)。

論理削除されたタスクはゴミ箱から復元可能であり、自動削除期限は設けず無期限保持する(req.md §20)。

明示的に「完全に削除」を実行した場合のみ物理削除する(req.md §20)。

### 7.2 削除済みノードの統一ルール

親子関係と依存関係のいずれについても、次の原則を採用する(req.md §24)。

> 削除済みノードは通常操作上は透明化するが、構造情報自体は保持する。

この原則は、場面ごとに削除済みノードの扱いを次のように使い分けることで実現される(req.md §24)。

| 場面 | 削除済みノードの扱い |
| --- | --- |
| 通常表示 | 無視 |
| blocked判定 | 無視（削除済みdependencyは無視） |
| cycle判定 | 含める |
| 復元 | 元の構造を利用 |

この使い分けが、後述する`effective_parent_id`、blocked判定、cycle判定、復元のそれぞれの仕様の背骨になっている。

### 7.3 論理削除と親子関係

親タスクを論理削除しても子タスクの`parent_id`は変更しない(req.md §21)。

```text
A
├─ B
└─ C
```

Aを削除すると、

```text
A.deleted_at = now()

B.parent_id = A.id
C.parent_id = A.id
```

となり、DB上では親子関係を保持したままAだけが削除済みになる(req.md §21)。

通常画面では削除済みノードを透明化して表示する(req.md §21)。

#### effective_parent_id

削除済み祖先を飛ばし、最も近い未削除祖先をアプリ上の親として扱う値を**effective_parent_id**と呼ぶ(req.md §22)。

```text
A
└─ B deleted
   └─ C
```

というDB上の構造（`C.parent_id = B`）に対して、Viewでは`C.effective_parent_id = A`となる(req.md §22)。

さらに、

```text
A deleted
└─ B deleted
   └─ C
```

のようにAとBがともに削除済みであれば、`C.effective_parent_id = NULL`となる(req.md §22)。

`effective_parent_id`はDBカラムには保存せず、View（9章）で算出する(req.md §22)。

`parent_id`（DB上の実際の親、以下**actual parent**）と`effective_parent_id`（削除済み祖先を透明化した後のアプリ上の親）は区別される概念であり、この区別は復元時のposition（7.5節）にも影響する。

### 7.4 論理削除と依存関係

タスクを論理削除しても`task_dependencies`レコードは削除しない(req.md §23)。

```text
A → B
```

Aを論理削除しても依存edgeは保持される(req.md §23)。

ただしblocked判定では削除済みタスクを無視する(req.md §23)。

```text
A = deleted
B = todo

B.is_blocked = false
```

Aを復元すると、元の依存関係も自動的に復活する(req.md §23)。

これは依存edge自体が物理削除されずに保持され続けているために成立する。

### 7.5 cycle判定と削除済みタスク

cycle判定では`deleted_at`を考慮せず、削除済みタスクを含むすべてのノードを見る(req.md §25)。

削除済みノードをcycle判定から除外してしまうと、「論理削除中はcycleなし、復元したらcycle」という矛盾した状態が生じうる(req.md §25)。

cycle判定に削除済みノードを含めることで、この矛盾を防ぐ(req.md §25)。

親子cycle Trigger（§48）とDependency Cycle Trigger（§49）は、いずれもdeleted taskを探索対象に含める(req.md §48, §49)。

### 7.6 復元

復元時に`parent_id`（actual parent）は変更しない(req.md §26)。

```text
A deleted
└─ B
```

であっても、Bのactual parentはAのままである(req.md §26)。

表示上のeffective parentとは別に扱う(req.md §26)。

復元対象は、actual parentを共有するsibling group（同じ`parent_id`を持つタスクの集合）の末尾へpositionを移動する(req.md §26, §56)。

親子関係や依存関係など、論理削除中に保持していた構造はそのまま再利用される(req.md §56)。

この復元処理はRPC（`restore_task`、12章）が1つの単位として担う。

### 7.7 完全削除

「完全に削除」を実行した場合にのみタスクを物理削除する(req.md §27)。

親タスクを完全削除する場合、子タスクは削除しない(req.md §27)。

```text
A
├─ B
└─ C
```

Aを完全削除すると、

```text
B.parent_id = NULL
C.parent_id = NULL
```

として子タスクを残す(req.md §27)。

Aに接続していたdependency edgeは物理削除する(req.md §27)。

この一連の処理は`permanently_delete_task`RPC（12章）が1トランザクションで行い、子タスクの`parent_id`のNULL化、子タスクのpositionのルート側での調整、関連dependency edgeの削除、対象タスクのDELETEを中途半端な状態を残さず実行する(req.md §57)。

## 8. 並び順

### 8.1 positionの意味

`position`は同一のactual parentを持つタスク間の順序を意味する(req.md §17)。

```text
parent_id = X
```

が同じタスク同士でpositionを比較する(req.md §17)。

ルートタスクは`parent_id IS NULL`を同じsibling groupとして扱う(req.md §17)。

依存関係の順序とは完全に独立する(req.md §17)。

### 8.2 手動並び替えの方式

タスクの手動並び替えを許可し、`position integer`を使用する(req.md §16)。

```text
A position=0
B position=1
C position=2
```

V1ではFractional IndexingやLexoRankは使用しない(req.md §16)。

`position`は同一actual sibling group内で、論理削除済みの行も含めて0から連番で連続する。
この不変条件を保つ採番規則は12.2節（`move_task`）、12.3節（`reorder_tasks`）、12.4節（`restore_task`）、12.5節（`permanently_delete_task`）が定める。
`move_task`の`p_new_position`にNULLを渡す末尾指定もこの不変条件を保つ側にある。
末尾は旧sibling groupの隙間を詰めた後の`max(position) + 1`であり、隙間空けのシフトを起こさずに連番の直後へ1つ足す（12.2節）。

Todoアプリの規模（数百から数千件程度、15章参照）を考慮し、この方式で十分と判断されている(req.md §16, §68)。

### 8.3 reorderとreparentの分離

単純な並び替えと親変更は意味的に分離する(req.md §18)。

**reorder**：同じactual parentの中で順番だけ変更する操作である。`parent_id`は変更せず、`position`のみを変更する(req.md §18)。

**reparent**：別の親へ移動する操作である。`parent_id`を変更し、`position`は新しいsibling group内の値へ変更する(req.md §18)。

この分離は、RPCとして`move_task`（reparentを含む移動）と`reorder_tasks`（reorderのみ）の2つを別に用意する設計にそのまま反映されている(req.md §54, §55)。

2つのRPCは位置の指定方法が異なる。
`move_task`の`p_new_position`は、論理削除済みの行も含めた新しいsibling group内の実positionである（12.2節）。
`reorder_tasks`の`p_ordered_task_ids`はIDの並びだけを渡すものであり、position値そのものは渡さない。
割り当てられるpositionは、可視の兄弟が現在占めているpositionの集合（slot）をそのまま使い回して決まる（12.3節）。

この違いを取り違えて`move_task`へ可視の兄弟の中での添字を渡すと、同一sibling groupに論理削除済みの行が残っている場合に、対象が意図した位置より手前へ入る。
クライアントが可視の兄弟しか列挙できないのは`app_tasks` Viewが論理削除済みを除外するためであり（9章）、可視の添字と実positionは論理削除済みの行を挟むとずれる。

### 8.4 sort_path

削除済み祖先を透明化した場合でも元のtree上の順序を維持するため、Viewには`sort_path`という派生値を用意する(req.md §46)。

```text
A position=0
├─ B deleted position=1
│  └─ C position=0
└─ D position=2
```

という構造において、Cの`sort_path = {0, 1, 0}`、Dの`sort_path = {0, 2}`となる(req.md §46)。

PostgreSQLのinteger arrayの辞書順比較を利用し、`order by sort_path`でtree上の順序を取得できるようにする(req.md §46)。

`sort_path`は実カラムとして保存しない(req.md §46)。

`sort_path`はactual parent側の`position`の並びをルートから辿って連結した配列であり、削除済みノードを挟んでいても、そのノードのpositionを配列に含めたまま子孫の順序を計算する。

これにより、削除済みノードがeffective_parent_idの算出では読み飛ばされる一方で、表示順序の計算では位置情報として活きるという役割分担になっている。

## 9. app_tasks View

アプリケーションからの通常読み取りでは、可能な限りrawな`tasks`テーブルを直接使用せず、`public.app_tasks`というViewを用意する(req.md §44)。

想定フィールドは次の通りである(req.md §44)。

```text
id
user_id

title
description

parent_id
effective_parent_id

position
sort_path

due_date
completed_at

is_blocked

created_at
updated_at
```

削除済みタスクは通常の`app_tasks`から除外する(req.md §44)。

`effective_parent_id`、`sort_path`、`is_blocked`はいずれもテーブルに保存されない派生値であり、このViewが算出する(req.md §22, §46, §12, §75)。

Viewは`security_invoker = true`を使用する(req.md §45)。

```sql
create view public.app_tasks
with (security_invoker = true)
as
...
```

**security_invoker**とは、Viewを実行するクエリの発行者の権限でView定義内の基底テーブルアクセスを評価するオプションである。

これにより、View経由でも基底テーブル（`tasks`）に設定されたRLSがそのまま適用される(req.md §45)。

タスクと依存関係の情報は別々に取得する設計であり、`app_tasks`と`task_dependencies`をそれぞれ取得し、必要に応じてアプリケーション側で関連付ける(req.md §69)。

Task View（`app_tasks`）にdependency arrayを埋め込む設計にはしない(req.md §69)。

## 10. RLS

RLS（Row Level Security、行単位アクセス制御）は`tasks`と`task_dependencies`の両方に有効化する(req.md §40)。

```sql
alter table public.tasks
enable row level security;

alter table public.task_dependencies
enable row level security;
```

基本条件は`user_id = next_auth.uid()`である(req.md §40)。

`next_auth.uid()`は認証セッションのユーザーIDを返す関数であり、詳細は13章で述べる。

RLS PolicyはあくまでUSING / WITH CHECKによる行フィルタであり、それ単体では`authenticated`ロールにテーブルへのアクセス権限を与えない。
ローカルスタックの`supabase/config.toml`は`auto_expose_new_tables`を設定しておらず（新方式の既定値である無効に従う）、`public` schema配下に作成したオブジェクトはData APIロールへ自動GRANTされない。
そのため、RLSの有効化とPolicy定義に加えて`authenticated`ロールへの基本権限を明示的にGRANTする（`supabase/migrations/20260808000006_rls_policies.sql:19-21`）。

```sql
grant select, insert, update, delete on public.tasks to authenticated;
grant select, insert, update, delete on public.task_dependencies to authenticated;
grant select on public.app_tasks to authenticated;
```

`public.app_tasks`が`select`のみなのは、Viewが読み取り専用の派生ロジックであり（9章）、書き込みは常に基底テーブルまたはRPC経由で行うためである。

本節のGRANTを欠くと、Policyは正しく定義されているのに`authenticated`ロールからは`permission denied for table tasks`となる。
設計書だけからschemaを再構成する場合は、この権限設定を落とさないこと。

`next_auth` schemaと`next_auth.uid()`に対する`authenticated` / `anon`へのGRANTは`docs/auth-design.md`第4.4節が扱う。

### 10.1 tasksのPolicy

SELECT Policyの概念は次の通りである(req.md §41)。

```sql
create policy tasks_select
on public.tasks
for select
to authenticated
using (
  user_id = next_auth.uid()
);
```

INSERT Policyの概念は次の通りである(req.md §42)。

```sql
create policy tasks_insert
on public.tasks
for insert
to authenticated
with check (
  user_id = next_auth.uid()
);
```

UPDATE Policyの概念は次の通りである(req.md §43)。

```sql
create policy tasks_update
on public.tasks
for update
to authenticated
using (
  user_id = next_auth.uid()
)
with check (
  user_id = next_auth.uid()
);
```

DELETEおよび`task_dependencies`についても、同様にユーザー所有権を保証するPolicyを設ける(req.md §43)。

### 10.2 RLSと複合FKによる二重の分離

親子関係、依存関係ともに異なるユーザーのタスクを関連付けることを禁止する(req.md §39)。

```text
User A / Task 1
        ↓
User B / Task 2
```

は作成不能とする(req.md §39)。

この禁止は、RLSだけでなく複合FK（`tasks_parent_same_user_fkey`、`task_dependency_task_fkey`、`task_dependency_depends_on_fkey`）によってもDBレベルで保証される(req.md §39, §37, §38)。

RLSがアクセス制御（誰がどの行を操作できるか）を担うのに対し、複合FKはデータ構造そのもの（異なるユーザーのタスク間に関係を作れないこと）を担う。

この二重の保証により、RLSの設定漏れやRPCが`SECURITY DEFINER`で実行されるような経路が仮に存在しても、cross-user relationはFK制約自体が拒否する。

## 11. Trigger

Triggerは主としてDBの不変条件を保証する層であり、対象は親子cycle禁止、dependency cycle禁止、blockedタスクの完了禁止、`updated_at`更新の4種である(req.md §47)。

アプリケーションのユースケース処理そのものはTriggerへ過剰に持たせない(req.md §47)。

### 11.1 親子cycle Trigger

`BEFORE INSERT`と`BEFORE UPDATE OF parent_id`で実行する(req.md §48)。

```text
BEFORE INSERT
BEFORE UPDATE OF parent_id
```

`NEW.parent_id`からancestorをrecursive CTEで辿り、途中で`NEW.id`へ到達した場合は`TASK_PARENT_CYCLE`として拒否する(req.md §48)。

deleted taskも探索対象とする(req.md §48)。

### 11.2 Dependency Cycle Trigger

`BEFORE INSERT ON task_dependencies`で実行する(req.md §49)。

```text
BEFORE INSERT
ON task_dependencies
```

新しい`task_id → depends_on_task_id`を追加した場合にcycleが発生するかをrecursive CTEで判定し、cycleになる場合は`TASK_DEPENDENCY_CYCLE`として拒否する(req.md §49)。

deleted taskも探索対象とする(req.md §49)。

Server Action側の`add_task_dependency`RPCは`INSERT task_dependencies`を実行するだけであり、cycle検出そのものはこのTriggerに委ね、ロジックを重複させない(req.md §53)。

### 11.3 blocked Completion Trigger

次の遷移を検知する(req.md §50)。

```text
OLD.completed_at IS NULL
AND
NEW.completed_at IS NOT NULL
```

対象タスクについて、未完了かつ未削除のdependencyが存在する場合は更新を拒否し、`TASK_BLOCKED`エラーを返す(req.md §50)。

completeTask（Server Action）は`completed_at = now()`を実行するだけであり、blockedかどうかの最終保証はこのTriggerが行う(req.md §62)。

Server Action側で同じ判定を必須とはしない(req.md §62)。

### 11.4 updated_at更新Trigger

`updated_at`の更新もTriggerの対象4種の1つとして挙げられている(req.md §47)。

行の更新時に`updated_at`を現在時刻へ書き換える、一般的なaudit column更新用のTriggerである。

## 12. RPC

RPCは必要な複合操作に限定し、V1では`move_task`、`reorder_tasks`、`add_task_dependency`、`restore_task`、`permanently_delete_task`の5種を想定する(req.md §52)。

基本的には`SECURITY INVOKER`を使用し、RLSを維持する(req.md §52)。

**SECURITY INVOKER**は、関数を呼び出したユーザーの権限で関数本体を実行する指定であり、`SECURITY DEFINER`（関数定義者の権限で実行する指定）とは対照的にRLSをバイパスしない。

RPC Functionについては実行権限を明示的に設定する(req.md §58)。

```sql
revoke execute
on function ...
from public, anon;

grant execute
on function ...
to authenticated;
```

RPCの引数名はすべて`p_`接頭辞を持つ（`p_task_id` / `p_new_parent_id` / `p_new_position` / `p_parent_id` / `p_ordered_task_ids` / `p_depends_on_task_id`）。
これは呼び出し規約そのものである。
supabase-jsの`client.rpc(name, args)`はargsのキーを関数の引数名と完全一致で解決するため、接頭辞を落とすと`PGRST202`（該当する関数が見つからない）になる。
以下の各節では、req.mdが挙げる論理的な引数名に対応する実際の引数名を併記する。

### 12.1 add_task_dependency

処理の流れは次の通りである(req.md §53)。

```text
Server Action
   ↓
add_task_dependency RPC
   ↓
INSERT task_dependencies
   ↓
Trigger
   ↓
cycle検出
```

cycle検出ロジックをRPCとTriggerで重複させず、不変条件はTrigger側を正とする(req.md §53)。

### 12.2 move_task

入力は`task_id`、`new_parent_id`、`new_position`である(req.md §54)。
実際の引数名は`p_task_id`、`p_new_parent_id`、`p_new_position`である。

1トランザクション内で、旧sibling groupのposition整理、`parent_id`変更、新sibling groupのposition整理を行う(req.md §54)。

`p_new_position`は、論理削除済みの行も含めた新しいactual sibling group内の実positionを指す。
その位置以降の兄弟を+1シフトしたうえで、対象をその位置へ置く。

`p_new_position`にNULLを渡した場合は、新しいactual sibling group（論理削除済みの行も含む）の末尾を指す(`supabase/migrations/20260813000002_move_task_append_to_tail.sql`)。
末尾は対象自身を除いた`coalesce(max(position) + 1, 0)`で求める。これは12.4節（`restore_task`）が末尾を求める式と同じである。
末尾をRPC側で求めるのは、`app_tasks` Viewが論理削除済みを除外するため、クライアントが移動先のsibling groupの実際の末尾を知れないためである（9章、8.3節）。
負の`p_new_position`は`INVALID_POSITION`（SQLSTATE `ET006`）で拒否するが、NULLはこの検査の対象外である。

末尾の解決は、旧sibling groupの隙間詰めより後に行う。
移動先が移動元と同じsibling groupの場合、詰める前に末尾を求めると対象自身が抜ける分だけ末尾が1つ大きくなり、8.2節の連番の不変条件を破ってpositionに穴が空く。
A(0) / B(1) / C(2) でAをNULL（末尾）へ移す場合、まずB → 0 / C → 1と詰め、続いてAを詰めた後の末尾（`max(1) + 1 = 2`）へ移すため、結果はB(0) / C(1) / A(2)となる。

親子cycleについてはTrigger（11.1節）が最終保証する(req.md §54)。

### 12.3 reorder_tasks

入力は`parent_id`と`ordered_task_ids[]`である(req.md §55)。
実際の引数名は`p_parent_id`、`p_ordered_task_ids`である。

並べ替えの対象は、指定されたactual sibling groupのうち論理削除されていないタスクのみとする。
対象が現在占めている`position`の集合をそのまま使い回し、`ordered_task_ids[]`の順に昇順で割り当てる。
論理削除済みタスクの`position`は変更しない。

論理削除済みタスクが存在しない場合、占めている`position`の集合は`0, 1, 2, ...`となるため、結果はreq.md §55の「`position = 0, 1, 2, ...`と再採番する」と一致する(req.md §55)。
差が生じるのは論理削除済みタスクが同一sibling groupに残っている場合に限られ、req.md §55はこのケースを規定していない。

論理削除済みタスクを対象から外すのは、クライアントが`app_tasks` View経由で可視のタスクしか列挙できないためである(10.1節)。
削除済みを含めて件数を検証すると、ゴミ箱にタスクがあるsibling groupでは並べ替えが常に失敗する。

対象が現在占めている`position`をそのまま使い回すのは、「actual sibling groupの`position`は論理削除済みを含めて0から連番で連続する」という不変条件を保つためである。
この不変条件は`move_task`の±1シフトと、新規作成時の末尾採番が前提としている。

対象が同一ユーザーかつ同一actual parentであり、かつ論理削除されていないことを検証する(req.md §55)。
`ordered_task_ids[]`に重複が含まれる場合も検証で弾く。同一タスクへ複数の`position`を割り当てて連番を壊すことを防ぐためである。

この検証に失敗した場合、すなわち`p_ordered_task_ids`が`NULL`である、配列長が対象の件数と一致しない、または重複や他グループのIDを含む場合は`INVALID_PARENT`（SQLSTATE `ET007`）を返す(`supabase/migrations/20260808000007_reorder_tasks_exclude_deleted_siblings.sql:63-69`)。
件数の不一致に`INVALID_POSITION`ではなく`INVALID_PARENT`を割り当てているのは、この検証が「渡されたID集合が指定sibling groupと一致するか」を見るものであり、個々の`position`値の妥当性を見るものではないためである。

### 12.4 restore_task

論理削除されたタスクを復元し、`deleted_at = NULL`とする(req.md §56)。

actual parentは変更せず、actual sibling groupの末尾へpositionを移動する(req.md §56)。

末尾へ移す前に、復元対象が元々占めていた`position`より後ろの兄弟を1つ詰める(`supabase/migrations/20260813000001_close_position_gaps_on_restore_and_delete.sql`)。
これにより8.2節の連番の不変条件が復元後も保たれ、req.md §56の末尾移動もそのまま成り立つ。
A(0) / B(1、論理削除済み) / C(2) でBを復元する場合、まずC → 1と詰め、続いてBを末尾へ移すため、結果はA(0) / C(1) / B(2)となる。

親子関係や依存関係など、論理削除中に保持していた構造をそのまま再利用する(req.md §56)。

### 12.5 permanently_delete_task

完全削除時は1トランザクションで、子タスクの`parent_id`のNULL化、子タスクのpositionのルート側での調整、関連dependency edgeの削除、対象タスクのDELETEを行い、中途半端な状態を残さない(req.md §57)。

これに加えて、対象が占めていた`position`より後ろの兄弟を1つ詰め、8.2節の連番の不変条件を保つ(`supabase/migrations/20260813000001_close_position_gaps_on_restore_and_delete.sql`)。

詰める処理は子のreparentより前に置く必要がある。
子を移すルート末尾を対象自身を除いた`max(position) + 1`で求めるため、詰めを後に置くと子の`position`が二重に詰まる。

ルート直下がB(0)だけで、Bが子X(0) / Y(1)を持つ場合を考える。
先に詰めるとルート末尾は0になり、X → 0 / Y → 1と採番され、BのDELETE後も`{0, 1}`で連番が保たれる。
逆にDELETEの後で詰めると、X → 0 / Y → 1を採番した後に`position > 0`の行を詰めるため、Y → 0となってXと重複する。

### 12.6 RPCに含めない操作

`removeDependency`は単純なdependency edge削除であり、直接DELETEでもよく、RPC必須とはしない(req.md §65)。

## 13. 認証

### 13.1 Auth.jsとGitHub OAuth

認証にはAuth.jsを使用し、ProviderはGitHub OAuthとする(req.md §30)。

```text
/login
  ↓
GitHub OAuth
  ↓
Auth.js callback
  ↓
Auth.js session
  ↓
Application
```

Auth.jsの永続化には`@auth/supabase-adapter`（Supabase Adapter）を使用する(req.md §30)。

Supabase Authは認証主体として使用しない(req.md §2.3)。

### 13.2 next_auth schema

Auth.jsの認証情報はSupabase PostgreSQLの`next_auth`schemaへ保存する(req.md §31)。

主要テーブルは`next_auth.users`、`next_auth.accounts`、`next_auth.sessions`、`next_auth.verification_tokens`である(req.md §31)。

TodoアプリのユーザーIDとして`next_auth.users.id`を使用する(req.md §31)。

`tasks.user_id`は`next_auth.users.id`を参照し、GitHub usernameやGitHub user IDをアプリケーション上の主キーとして直接利用しない(req.md §32)。

概念的には、GitHub accountが`next_auth.accounts`に紐付き、Auth.js user UUIDが`next_auth.users.id`となり、それが`tasks.user_id`として使われる(req.md §32)。

### 13.3 Custom JWTによる認証分離

Auth.jsのsessionとSupabase Data API用JWT（JSON Web Token）は別物として扱う(req.md §33)。

Auth.js Sessionの目的はNext.js側でログインユーザーを識別することであり、Supabase Custom JWTの目的はPostgreSQL/RLSに「誰としてDBアクセスしているか」を伝えることである(req.md §33)。

GitHub access tokenをSupabaseへ直接渡さない(req.md §33)。

Next.js Server ActionからSupabase Data APIへアクセスする際、短寿命のCustom JWTを生成する(req.md §34)。

JWTには少なくとも`sub`、`role`、`exp`を含める(req.md §34)。

`sub`はAuth.js user UUIDであり、`role`は`authenticated`である(req.md §34)。

概念的には、Auth.js sessionの`session.user.id`がCustom JWTの`sub`（`role`は`authenticated`）となり、それがsupabase-js経由でPostgreSQLへ渡る(req.md §34)。

### 13.4 next_auth.uid()

PostgreSQL/RLS上では`next_auth.uid()`をユーザー識別に利用する(req.md §35)。

この関数は本リポジトリのmigrationが定義する(`supabase/migrations/20260808000001_next_auth_schema.sql:40-48`)。
`@auth/supabase-adapter`はSQLを配布しないため、Adapterをインストールしただけでは存在しない。
定義の詳細は`docs/auth-design.md`第4.2節が扱う。

`next_auth.uid()`はJWTの`sub`からAuth.js user UUIDを取得する(req.md §35)。

したがって、`JWT.sub`と`next_auth.users.id`と`tasks.user_id`が一致する状態を成立させる(req.md §35)。

これが10章のRLS Policyにおける`user_id = next_auth.uid()`という条件の根拠になっている(req.md §40)。

### 13.5 Supabase Clientの分離

Auth.js内部用とTodoアプリ用の、2種類のSupabase clientを明確に分離する(req.md §36)。

Auth.js内部用は、Auth.js Adapterが認証情報を管理するために使用し、サーバー専用のsecret keyを利用する(req.md §36)。

```text
Auth.js
  ↓
Supabase Adapter
  ↓
next_auth schema
```

Todoアプリ用は、ユーザーとしてTodoデータへアクセスするためのclientであり、publishable keyとCustom JWTを利用してRLSを適用する(req.md §36)。

Auth.js内部用のsecret keyをTodo操作に使用しない(req.md §36)。

createTask（Server Action）は、`user_id`をクライアント入力として信用せず、Auth.js sessionから生成したCustom JWTによって`next_auth.uid()`と一致する`user_id`だけをRLSで許可する(req.md §60)。

必要であればServer Action側で明示的にsession user IDを設定する(req.md §60)。

## 14. エラー契約

DBからアプリへ返す代表的なエラーコードを固定する(req.md §66)。

```text
TASK_NOT_FOUND

TASK_PARENT_CYCLE

TASK_DEPENDENCY_CYCLE

TASK_BLOCKED

DEPENDENCY_ALREADY_EXISTS

INVALID_POSITION

INVALID_PARENT
```

Next.js側では型として管理する(req.md §66)。

```ts
type TaskErrorCode =
  | "TASK_NOT_FOUND"
  | "TASK_PARENT_CYCLE"
  | "TASK_DEPENDENCY_CYCLE"
  | "TASK_BLOCKED"
  | "DEPENDENCY_ALREADY_EXISTS"
  | "INVALID_POSITION"
  | "INVALID_PARENT"
```

Server ActionでDBエラーをUI向けエラーへ変換する(req.md §66)。

### 14.1 SQLSTATEによる契約

各エラーコードには専用のSQLSTATEを割り当てる。
`RAISE EXCEPTION` の `using errcode` で明示し、あわせてメッセージ先頭にもコード文字列を置く(`supabase/migrations/20260808000004_triggers.sql:8-15`)。

| SQLSTATE | TaskErrorCode | 発生元 |
| --- | --- | --- |
| `ET001` | `TASK_NOT_FOUND` | `move_task` / `add_task_dependency` / `restore_task` / `permanently_delete_task`（migration 0005） |
| `ET002` | `TASK_PARENT_CYCLE` | 親子cycle Trigger（11.1節） |
| `ET003` | `TASK_DEPENDENCY_CYCLE` | dependency cycle Trigger（11.2節） |
| `ET004` | `TASK_BLOCKED` | blocked completion Trigger（11.3節） |
| `ET005` | `DEPENDENCY_ALREADY_EXISTS` | `add_task_dependency`（migration 0005） |
| `ET006` | `INVALID_POSITION` | `move_task`（migration 0005） |
| `ET007` | `INVALID_PARENT` | `move_task` / `reorder_tasks`（migration 0005、0007） |

`ET`で始まる5文字を選んでいるのは、PostgreSQLが`RAISE EXCEPTION`の既定に用いる`P0001`や標準のクラスコードと衝突しない領域であるためである。

Next.js側の変換は`src/features/task/lib/map-db-error.ts`が持つ。
`PostgrestError.code`（SQLSTATE）を最優先で引き、次にメッセージ先頭のコード文字列で引く。
SQLSTATEを優先するのは、メッセージ文言が将来変わっても契約が壊れないようにするためである。
どちらでも判別できない契約外のエラーは`TaskErrorCode`へ変換せず、握りつぶさずre-throwする。

表示専用の連番は持たない。
番号はSQLSTATEの1系統だけとし、利用者の報告からmigrationのSQLを直接検索できる状態を保つ。

上表の割り当ては`supabase/tests/010_error_contract.test.sql`が`throws_ok`で固定する(`docs/migration-design.md` 7.7節)。

### 14.2 各コードの発生条件

**TASK_NOT_FOUND**：操作対象のタスクが存在しない、または（RLSにより）他ユーザーのタスクであるためアクセスできない場合に返す。RPCが対象行を`select`できなかった時点で判定する。

**TASK_PARENT_CYCLE**：親子cycle Trigger（11.1節）が、`NEW.parent_id`から辿った祖先に`NEW.id`が含まれると判定した場合に返す(req.md §48)。

**TASK_DEPENDENCY_CYCLE**：Dependency Cycle Trigger（11.2節）が、新しい依存edgeの追加によってcycleが生じると判定した場合に返す(req.md §49)。

**TASK_BLOCKED**：blocked Completion Trigger（11.3節）が、未完了かつ未削除のdependencyを持つ未完了タスクを完了させようとした場合に返す(req.md §13, §50)。

**DEPENDENCY_ALREADY_EXISTS**：`add_task_dependency`が、同じ`(user_id, task_id, depends_on_task_id)`の行が既に存在すると判定した場合に返す(req.md §38, §66)。主キーの重複INSERTに任せず、RPC側で先に検出する。

**INVALID_POSITION**：`move_task`が受け取る`p_new_position`が負値の場合に返す。`reorder_tasks`はこのコードを返さない。並べ替えは`position`値を引数に取らず、可視の兄弟が占めている`position`の集合を使い回すためである（12.3節）。

**INVALID_PARENT**：`move_task`が指定された`p_new_parent_id`のタスクを見つけられなかった場合、および`reorder_tasks`が`p_ordered_task_ids`と対象sibling groupの不一致を検出した場合に返す（12.3節）。`tasks_not_own_parent`制約と`tasks_parent_same_user_fkey`制約の違反はTriggerやRPCを経由せず制約自身が拒否するため、SQLSTATEは制約違反の標準コード（`23xxx`）になり、本コードへは変換されない。

## 15. インデックス方針、一覧取得、同時実行の割り切り

### 15.1 インデックス方針

req.md §67は6本のインデックスを候補として挙げ、PRIMARY KEYやUNIQUE制約で既に生成されるindexとの重複を確認した上で作成することを求めている(req.md §67)。

この確認の結果、5本を採用し1本を不採用とした(`supabase/migrations/20260808000002_tasks_and_dependencies.sql:79-100`)。

| インデックス | 採用 | 実際の名前と理由 |
| --- | --- | --- |
| `tasks(user_id, parent_id)` | 採用 | `tasks_user_id_parent_id_idx`。`tasks_parent_same_user_fkey`の参照元列だが、参照元列自体には自動でindexが張られないため必要 |
| `tasks(user_id, deleted_at)` | 採用 | `tasks_user_id_deleted_at_idx`。`app_tasks` Viewの削除済み除外条件とゴミ箱一覧の絞り込みに使う |
| `tasks(user_id, completed_at)` | 採用 | `tasks_user_id_completed_at_idx`。完了/未完了での絞り込みに使う |
| `tasks(user_id, due_date)` | 採用 | `tasks_user_id_due_date_idx`。期日での絞り込み・並び替えに使う |
| `task_dependencies(user_id, task_id)` | **不採用** | PRIMARY KEY `(user_id, task_id, depends_on_task_id)` の先頭2列と一致し、既存のPK indexで代替できる |
| `task_dependencies(user_id, depends_on_task_id)` | 採用 | `task_dependencies_user_id_depends_on_task_id_idx`。PKのindexは`(user_id, task_id, ...)`順であり、依存元の逆引きには別途indexが要る |

検索用`ILIKE '%query%'`についてはV1では高度なindex最適化を行わず、必要になった場合に`pg_trgm`等を検討する(req.md §67)。
なお現状の検索はDBへ問い合わせず、クライアント側で取得済み一覧を絞り込む実装である（`docs/frontend-design.md` §4 の `filter-tasks.ts`）。

### 15.2 一覧取得

V1ではページネーションを実装しない(req.md §68)。

個人Todo用途を想定し、そのユーザーの未削除タスク全件を取得可能とし、数百から数千件程度を想定する(req.md §68)。

ただしData API側に件数の上限がある。
`supabase/config.toml:18`は`max_rows = 1000`であり、`src/features/task/lib/queries.ts`の`.select("*")`は1000件を超える分を警告なく切り捨てる。
req.mdが想定する「数千件」の上端はこの上限を超えるため、現状は1000件までしか正しく表示できない。
対処（ページネーションの導入、または`max_rows`の引き上げ）は決めていない（`docs/frontend-design.md` 第 13 章）。

`max_rows`はhosted Supabase側では`config.toml`から反映されず、Dashboardの設定が別に効く(`docs/deploy.md` 第5章)。

タスクとdependency情報は別々に取得し、`app_tasks`と`task_dependencies`をそれぞれ取得して必要に応じてアプリケーション側で関連付ける(req.md §69)。

### 15.3 同時実行の割り切り

cycle判定はrecursive CTEとTriggerで行う(req.md §70)。

ただし、複数トランザクションから同時にグラフ構造を変更する極端なケースでは、MVCC（Multi-Version Concurrency Control、PostgreSQLの多版型同時実行制御）上それぞれの未commit変更が互いに見えない問題があり得る(req.md §70)。

dagdoでは競合頻度が低いため、V1で複雑なロック機構を必須としない(req.md §70)。

必要になった場合、user_id単位のPostgreSQL advisory lockなどを検討する(req.md §70)。

この割り切りは、個人利用を主用途とし(req.md §3.1)、数百から数千件規模を想定する(req.md §68)というdagdoの利用規模の前提に対応している。

## 16. V1の設計原則

req.mdは7つの設計原則を挙げている(req.md §75)。

**1. DBを信頼できる状態にする**：Server Actionを経由しなくても、cycle、cross-user relation、blocked completionなどの不正状態を可能な限りDBが拒否する(req.md §75)。

**2. 派生状態を保存しない**：`is_blocked`、`effective_parent_id`、`sort_path`は保存せず、元データから算出する(req.md §75)。

**3. 論理削除で構造を失わない**：削除時に親子関係と依存関係を可能な限り保持する(req.md §75)。

**4. Triggerにユースケースを書きすぎない**：Triggerは不変条件の保証に限定し、複数行操作はRPCで扱う(req.md §75)。

**5. Server Actionをアプリケーション境界にする**：ブラウザからPostgreSQL Functionを直接意識させず、UIからServer Action、RPC/DBという経路を基本とする(req.md §75)。

**6. RLSとFKの双方でユーザーを分離する**：認可だけに頼らず、データ構造自体でもcross-user relationを禁止する(req.md §75)。

**7. V1はシンプルに保つ**：将来拡張可能性だけを理由に、タグ、プロジェクト、履歴、通知、繰り返し、複雑なランキングアルゴリズムなどを先行導入しない(req.md §75)。

この7原則のうち、1、4、5、6は責務分割（2章）に、2は状態モデルとView（4章、9章）に、3は論理削除（7章）に、それぞれ対応する。

7は、V1で実装しない機能としてタグ、プロジェクト専用エンティティ、優先度、通知、繰り返しタスク、添付ファイル、完了履歴、更新履歴、アーカイブ専用機能を明示的に挙げていることにも表れている(req.md §29)。

これらのV1対象外機能の代わりに、親子関係によるタスクのグルーピングで代替する方針である(req.md §29)。

## 17. 用語集

**blocked**：未完了かつ未削除の依存先を1件以上持つ未完了タスクの状態(req.md §12)。DBカラムとしては保存せず、依存関係から動的に算出する(req.md §5)。

**Ready**：req.mdの本文には正式な定義がなく、Ready、Blocked、Done等の分類はUI/UXの詳細設計項目として今後検討するとされている(req.md §72)。DB設計上のblockedの否定（未完了かつblockedでない状態）に対応する概念だと推測されるが、この対応関係自体はreq.mdに明記されていない。

**actual parent**：`tasks.parent_id`が指すDB上の実際の親タスクのこと。論理削除による透明化を経ない、生の親子関係を指す(req.md §17, §26)。`effective_parent_id`と対比される。

**effective_parent_id**：削除済み祖先を飛ばし、最も近い未削除祖先をアプリ上の親として扱う値(req.md §22)。DBカラムには保存せず、`app_tasks`Viewが算出する(req.md §22, §75)。

**sort_path**：削除済み祖先を透明化してもtree上の順序を維持するための、integer arrayによる派生値(req.md §46)。ルートから各階層のpositionを連結した配列であり、辞書順比較でtree順序を得る(req.md §46)。実カラムとしては保存しない(req.md §46, §75)。

**RLS（Row Level Security）**：PostgreSQLの行単位アクセス制御機能。dagdoでは`user_id = next_auth.uid()`を基本条件として`tasks`と`task_dependencies`に適用する(req.md §40)。

**RPC（Remote Procedure Call）**：本文書ではSupabase RPC（PostgreSQL Functionの呼び出し）を指す。複数行更新や複数操作を1トランザクションとして扱う層であり、`move_task`、`reorder_tasks`、`add_task_dependency`、`restore_task`、`permanently_delete_task`の5種を想定する(req.md §51, §52)。

**security_invoker**：PostgreSQL Viewのオプションの1つ。Viewを実行するクエリ発行者の権限で基底テーブルアクセスを評価し、View経由でも基底テーブルのRLSを適用させる(req.md §45)。

**SECURITY INVOKER**：PostgreSQL Functionのオプションの1つ。関数を呼び出したユーザーの権限で関数本体を実行し、RLSを維持する。dagdoのRPCは基本的にこれを使用する(req.md §52)。

**forest**：複数の木構造（tree）の集合のこと。dagdoの親子関係は、1タスクにつき親が最大1つで循環を禁止することにより、forest構造をなす(req.md §8)。

**DAG（Directed Acyclic Graph、有向非巡回グラフ）**：辺に向きがあり、かつ循環を含まないグラフ構造のこと。dagdoの依存関係はDAGとして設計される(req.md §10)。

**next_auth schema**：Auth.jsの認証情報を保存するPostgreSQL schema。`next_auth.users`、`next_auth.accounts`、`next_auth.sessions`、`next_auth.verification_tokens`を含む(req.md §31)。

**next_auth.uid()**：PostgreSQL/RLS上でユーザーを識別するためのSQL関数。Custom JWTの`sub`からAuth.js user UUIDを取得する(req.md §35)。定義は本リポジトリのmigration（`supabase/migrations/20260808000001_next_auth_schema.sql:40-48`）が持つ。

**Custom JWT**：Next.js Server ActionからSupabase Data APIへアクセスする際に生成する短寿命のJWT。`sub`（Auth.js user UUID）、`role`（`authenticated`）、`exp`を含む(req.md §34)。Auth.jsのsessionとは別物として扱う(req.md §33)。

**Trigger**：どの経路からDBを書き換えても破られてはいけない不変条件を保証するPostgreSQLの機構。dagdoでは親子cycle禁止、dependency cycle禁止、blockedタスクの完了禁止、`updated_at`更新の4種に用いる(req.md §47, §51)。

**recursive CTE（再帰的共通テーブル式）**：自身の結果集合を再帰的に参照するSQLのWITH句。dagdoでは親子cycle Triggerとdependency cycle Triggerが、祖先やcycleの探索に用いる(req.md §48, §49)。

**MVCC（Multi-Version Concurrency Control、多版型同時実行制御）**：PostgreSQLが採用する同時実行制御方式。dagdoでは、複数トランザクションが同時にグラフ構造を変更する場合に、互いの未commit変更が見えない問題の背景として言及される(req.md §70)。

---

対象リポジトリ: dagdo
対象コミット: 2752573
作成日: 2026-08-08
更新日: 2026-08-13
生成者: Claude Code
