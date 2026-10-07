-- ============================================================
-- xinghe-helper 数据库建表脚本（schema.sql）
-- ============================================================
-- 依据：docs/api-contract.md 第 1 节「涉及的数据表」（契约是唯一来源，不另造字段）
-- 运行环境：CloudBase PostgreSQL —— 控制台 → 数据库 → SQL 编辑器
-- 可重复执行：脚本开头先删表（级联）再重建，跑几遍结果都一样
--   ⚠️ 注意：这套写法会连数据一起清掉。现阶段库里没有真实数据，无影响；
--      等有了真实报名数据后，别再直接跑这个脚本（到时会另外给你"不删表"的版本）。
-- 建表顺序：camps → rooms → students → assignment_history
--   有外键依赖（students 要引用 rooms / camps），顺序不能调换。
-- ============================================================


-- ========== 0. 清理旧表（让脚本可以重复执行）==========
-- 依次删除四张表；cascade 表示连带依赖对象一起删，避免外键挡住删除
drop table if exists public.assignment_history cascade;
drop table if exists public.students cascade;
drop table if exists public.rooms cascade;
drop table if exists public.camps cascade;


-- ========== 1. 营期 camps ==========
-- MVP 只用一个营期（第 1 行）；camp_id 字段先留着，以后要支持多营期不用改表
create table public.camps (
  id         bigserial    primary key,
  name       varchar(100) not null,            -- 营期名称，如"第一期口语拉练营"
  org_name   varchar(100),                     -- 机构名称，可空
  created_at timestamptz  not null default now()
);


-- ========== 2. 房间 rooms ==========
-- 必须先于 students 建，因为 students.assigned_room_id 要引用它
create table public.rooms (
  id           bigserial   primary key,
  camp_id      bigint      not null references public.camps(id),  -- 属于哪个营期
  room_no      varchar(20) not null,                              -- 房号，如 '301'
  capacity     int         not null,                              -- 可住人数
  gender_label varchar(2),                                        -- 性别标签(男/女)，空=尚未确定
  created_at   timestamptz not null default now(),

  constraint rooms_capacity_positive  check (capacity > 0),
  constraint rooms_gender_label_valid check (gender_label in ('男', '女')),
  -- 同一个营期里的房号不能重复（对应契约 2.6 的 409 ROOM_NO_DUPLICATED）
  constraint rooms_camp_room_no_key   unique (camp_id, room_no)
);


-- ========== 3. 学生 students ==========
-- 说明：一条记录 = 一次提交。同一人重复提交时保留最新一条，
--       旧记录 is_latest=false + superseded_by=新记录id（留痕，不物理删除）
create table public.students (
  id               bigserial   primary key,
  camp_id          bigint      not null references public.camps(id),
  name             varchar(50) not null,
  gender           varchar(2)  not null,
  teacher          varchar(20) not null,
  class_level      varchar(10) not null,
  check_in_date    date        not null,        -- 入住日期：信息性字段，不参与分房约束
  room_pref        int         not null,        -- 期望拼房人数 1~6
  snore            boolean,                     -- 是否打呼噜，可空（未填）
  sleep_quality    varchar(10),                 -- 睡眠质量，可空
  note             text,                        -- 备注，可空
  is_latest        boolean     not null default true,   -- 是否该学生的最新记录
  superseded_by    bigint      references public.students(id),  -- 被哪条新记录取代
  assigned_room_id bigint      references public.rooms(id),     -- 分配真相，NULL=未分配
  assign_status    varchar(10) not null default '未分配',
  created_at       timestamptz not null default now(),

  -- 取值约束（与前端表单选项 web/src/pages/StudentForm.jsx 一致）
  constraint students_gender_valid      check (gender in ('男', '女')),
  constraint students_teacher_valid     check (teacher in ('Mona', 'Kiven', 'Selena', 'Betty', 'Priya')),
  constraint students_class_valid       check (class_level in ('星一', '星二', '星三')),
  constraint students_room_pref_valid   check (room_pref between 1 and 6),
  constraint students_sleep_quality_valid check (sleep_quality in ('好', '一般', '差')),
  constraint students_assign_status_valid check (assign_status in ('未分配', '已分配')),

  -- 分配状态必须自洽：有房间号=已分配，没房间号=未分配
  -- （对应契约 2.9：room_id 为空时 assign_status 必须为"未分配"）
  constraint students_assign_consistent check ((assigned_room_id is null) = (assign_status = '未分配')),

  -- 不能把"取代我的人"指向自己
  constraint students_superseded_not_self check (superseded_by is null or superseded_by <> id)
);

-- 工作台主查询：按营期取最新记录（对应契约 2.4）
create index idx_students_workbench on public.students (camp_id, is_latest, id);

-- 未分配名单查询（按性别分组，对应契约 2.4 左栏 / 分房引擎）
create index idx_students_unassigned on public.students (camp_id, gender)
  where assigned_room_id is null;

-- 按房间查成员（房间卡片成员列表 / 删房时把人放回未分配）
create index idx_students_assigned_room on public.students (assigned_room_id);


-- ========== 4. 分房历史快照 assignment_history ==========
-- 用于"恢复 AI 方案"按钮：存每次一键分房的完整结果
create table public.assignment_history (
  id         bigserial   primary key,
  camp_id    bigint      not null references public.camps(id),
  run_type   varchar(10) not null,              -- 'ai' = 一键分房，'manual' = 手动调整
  snapshot   jsonb       not null,              -- 完整方案快照
  created_at timestamptz not null default now(),

  constraint history_run_type_valid check (run_type in ('ai', 'manual'))
);

-- 取"最近一次 AI 快照"（对应契约 2.12，按时间倒序取第一条）
create index idx_history_latest on public.assignment_history (camp_id, run_type, created_at desc);


-- ============================================================
-- 跑完检查：左侧表列表里应该出现 4 张表
--   camps / rooms / students / assignment_history
-- 数据由下一步的 seed.sql 负责插入，本脚本不插任何数据。
--
-- ⚠️ 本脚本暂未配置权限（GRANT / RLS）。CloudBase 默认开启行级安全，
--    等第 3 周写接口时才需要配权限，届时另行处理。
-- ============================================================
