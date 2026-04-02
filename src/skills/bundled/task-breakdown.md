---
name: task-breakdown
description: 大任务拆解为可执行的子任务
when_to_use: 当用户要求拆解任务、分解工作、制定计划时
allowed_tools: [TaskManager, MemoryTool]
execution_mode: fork
---

# 大任务拆解

请对以下任务进行拆解：$ARGUMENTS

拆解步骤：

1. 分析任务的整体目标和范围
2. 识别关键里程碑和阶段
3. 将每个阶段拆解为具体可执行的子任务
4. 为每个子任务评估优先级和预计耗时
5. 识别子任务之间的依赖关系
6. 按以下格式输出拆解方案：
   - 任务概述
   - 子任务列表（含描述、优先级、预计耗时、依赖关系）
   - 建议执行顺序
   - 风险提示
