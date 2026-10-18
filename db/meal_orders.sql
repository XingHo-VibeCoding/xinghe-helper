-- ============================================================
-- xinghe-helper 订餐功能 —— 建表脚本（meal_orders）
-- ============================================================
-- 用途：每日订餐记录。一条记录 = 某人在某一天的订餐选择。
-- 覆盖两批人：学生（role='student'）与工作人员（role='staff'）。
--
-- 幂等：可重复执行（先删后建），跑几遍结果都一样。
--   ⚠️ 会连数据一起清掉。当前功能未上线、库里没有真实订餐数据，无影响。
--      接真实数据后请改用文件末尾的增量写法。
--
-- 为什么单独一个文件、不写进 schema.sql：
--   schema.sql 是住宿模块的 4 张表（Day 16 建的），已验证过、已在用。
--   订餐是新模块，混进去会让「改住宿表结构」和「加订餐表」两件事混在一起，
--   出问题时不好定位是哪块引起的。
-- ============================================================


-- ========== 清理旧表（让脚本可以重复执行）==========
drop table if exists public.meal_orders cascade;


-- ========== 建表 ==========
create table public.meal_orders (
  id          bigserial   primary key,
  camp_id     bigint      not null references public.camps(id),

  -- 哪一天的餐。这个值来自二维码链接里的 ?date=，
  --   所以它是「这张码代表哪一天」的唯一依据 —— 改码 = 换一天。
  meal_date   date        not null,

  -- 身份：学生 / 工作人员。
  -- ⚠️ 由页面写死，不让用户填。
  --   用户强调「学生码和工作人员码一定不能搞混」，
  --   如果让用户在表单里选身份，等于把区分责任交给填表的人 ——
  --   一旦手滑选错，学生的订单就混进工作人员的统计里，而且很难发现。
  --   由两个独立页面各自写死，前端根本没有出错的余地。
  role        varchar(10) not null,

  name        varchar(50) not null,

  -- 下面两个字段只有 role='student' 时有值，role='staff' 时为 NULL
  teacher     varchar(20),
  class_level varchar(10),

  -- 下面这个字段只有 role='staff' 时有值，role='student' 时为 NULL
  department  varchar(20),

  -- 订不订这一顿。两个都是必填（不订要明确写 false，不能留空），
  --   留空的话汇总时无法区分「没填」和「不订」，数字会算错。
  lunch       boolean     not null,
  dinner      boolean     not null,

  created_at  timestamptz not null default now(),

  constraint meal_role_valid check (role in ('student', 'staff')),

  -- 取值约束跟 students 表保持一致（同一批选项）。
  --   两处口径不一致是这类功能最常见的 bug 来源：
  --   学生页改了选项、汇总页还按老选项分组，于是某个班凭空消失。
  --   用「is null or」是因为工作人员的这些字段本来就是 NULL。
  constraint meal_teacher_valid check (teacher is null or teacher in ('Mona', 'Kiven', 'Selena', 'Betty', 'Priya')),
  constraint meal_class_valid   check (class_level is null or class_level in ('星一', '星二', '星三')),
  constraint meal_dept_valid    check (department is null or department in ('教学部', '市场部', '其他部门')),

  -- ========== 交叉约束（防脏数据的关键）==========
  -- 身份和字段必须自洽：
  --   学生     → 必须有 老师+年级，且没有 部门
  --   工作人员 → 必须有 部门，且没有 老师+年级
  --
  -- 为什么需要这条：
  --   光看上面三个 CHECK，理论上可以存进
  --   「role='student' 但 department='教学部'」这种记录（两边约束都通过）。
  --   而它一旦进去，汇总表就出现「某个班人数莫名 +1」或者「教学部多 1 个人」，
  --   查起来极难定位 —— 因为约束是绿的、数据是合法的。
  --   加了这条，任何不自洽的写入在入库那一刻就被挡住。
  --
  -- 注意：服务端也应该自己校验一遍并给出人话报错
  --   （「学生订餐不用填部门」），不要让用户看到数据库约束名。
  constraint meal_role_fields_consistent check (
    (role = 'student' and teacher is not null and class_level is not null and department is null)
    or
    (role = 'staff'    and department is not null and teacher is null and class_level is null)
  )
);


-- ========== 判重 ==========
-- 同一身份 + 同一天 + 同一分组 + 同一姓名 只能有一条。
--
-- ⚠️⚠️ 这里必须用 coalesce 把 NULL 当空串处理，原因很关键：
--   PostgreSQL 的 unique 索引认为 NULL ≠ NULL ——
--   也就是说，如果直接对 teacher 建索引，
--   同一个工作人员（teacher 是 NULL）能插出无数条重复记录，
--   重复提交就再也去不掉了，汇总数字会一直往上飘。
--
--   所以这里用表达式索引：coalesce(teacher, '')
--   把 NULL 归一成空串，NULL 之间就变成「相等」了，unique 才生效。
--
-- 判重维度说明：
--   学生     → 姓名 + 老师 + 年级（部门恒为 NULL）
--   工作人员 → 姓名 + 部门（老师/年级恒为 NULL）
--
-- ⚠️ 已知取舍（用户拍板）：不收手机号。
--   风险是「同名 + 同组」的极小概率撞车，后提交者覆盖前一个，数字少 1 份。
--   住宿表那边是按手机号判的（Day 28 的教训：同名学生互相顶掉），
--   订餐表为了不增加填表负担改用组合判重。
--
-- 为什么用数据库唯一索引，而不是应用层「先查有没有、再决定 insert 还是 update」：
--   应用层判断在并发下有漏洞 —— 两个人同一毫秒提交，应用层都查到「没有」，
--   于是都执行 insert，结果两条重复记录。
--   数据库的唯一索引是原子的，谁先到谁成功。
--
-- ⚠️ 配套注意：应用层 upsert 的 on conflict 目标必须正好是这个表达式索引，
--    写法要对齐 coalesce 的顺序，否则会报「没有匹配的唯一约束」。
create unique index idx_meals_uniq_per_day
  on public.meal_orders (
    camp_id, meal_date, role,
    coalesce(teacher, ''), coalesce(class_level, ''), coalesce(department, ''),
    name
  );


-- ========== 查询索引 ==========
-- 汇总页主查询：按天取全部订单，再按 role + 老师/年级/部门 分组数人数
create index idx_meals_by_date on public.meal_orders (camp_id, meal_date);


-- ============================================================
-- 权限
-- ------------------------------------------------------------
-- 与住宿表一致：读接口走平台网关的 anon 身份，已经能正常读。
-- 写接口如果报权限错误，再补这句：
--
--   grant insert, update on public.meal_orders to anon;
--
-- 不建外键到 students —— 工作人员根本不订房，
-- 学生也可能只订餐不订房，建外键会让这些记录插不进来。


-- ============================================================
-- 跑完检查
-- ------------------------------------------------------------
-- select count(*) from public.meal_orders;              -- 应为 0
-- select indexname from pg_indexes
--   where tablename = 'meal_orders';                     -- 应有 2 个索引
--
-- 验交叉约束（应该报错才对）：
--   -- 角色不匹配时必须被拒绝：
--   insert into public.meal_orders
--     (camp_id, meal_date, role, name, lunch, dinner)
--   values (1, current_date, 'student', '测试', true, true);
--   -- 期望：violates check constraint "meal_role_fields_consistent"
--
--   -- 工作人员的重复提交必须被顶掉而不是插两条：
--   insert into public.meal_orders
--     (camp_id, meal_date, role, name, department, lunch, dinner)
--   values (1, current_date, 'staff', '张伟', '教学部', true, false);
--   insert into public.meal_orders
--     (camp_id, meal_date, role, name, department, lunch, dinner)
--   values (1, current_date, 'staff', '张伟', '教学部', false, true);
--   select lunch, dinner from public.meal_orders
--     where role='staff' and name='张伟';
--   -- 期望：只有一行，且是 false / true（被第二条覆盖）
-- ============================================================


-- ============================================================
-- 【以后要接真实数据时】把这段放进 ALTER，不要再跑上面的 drop
-- ============================================================
-- alter table public.meal_orders enable row level security;
-- grant select on public.meal_orders to anon;
-- grant insert, update on public.meal_orders to anon;