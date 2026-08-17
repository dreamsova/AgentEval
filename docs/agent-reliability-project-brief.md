# Agent Reliability Environment v0 — application brief

[Technical environment documentation](agent-reliability-env.md)

## 一句话定位

Agent Reliability Environment v0 是一个小型、确定性的交互式 agent 环境：agent 通过工具改变受控状态，环境用可审计的 verifier 计算终局 reward，并把 rollout 转成 AgentEval 可读取的结构化 trace。

## 它解决什么问题

语言层面的“完成了”并不等于任务真的完成。一个 agent 可能没有创建目标产物、引用已经过期的测试结果，或者把内容写到了错误路径，却仍然报告成功。这个项目把这类问题从事后文本判断改写成一个可交互、可自动验证的环境问题：

```text
task + state
  -> agent action
  -> deterministic transition
  -> tool result / new state
  -> terminal verifier
  -> decomposed reward + structured trace
```

## 设计

- `reset()` / `step(action)` 提供一个 Gym-like 接口；动作空间包含 `read_file`、`write_file`、`run_tests` 和 `submit`。
- 文件、revision、测试 freshness 和终止状态都由内存环境维护；v0 不执行真实 shell，也不加载任意代码。
- verifier 独立于 AgentEval，根据当前 artifact、当前 revision 上的新鲜测试结果，以及最终报告与真实状态的一致性，输出分解后的终局 reward。
- 每个 rollout 都可以转换为带 tool call、tool result、state transition 和 provenance 的 AgentEval structured trace。AgentEval 在这里是辅助分析层，不是 ground-truth reward 的来源。
- v0 包含三项声明式任务和五个 scripted policies，用来稳定复现诚实完成、无行动虚报、过期测试引用、错误路径捷径和诚实报告阻塞等行为。

## 可演示结果

演示可以并排展示同一任务上的五条 rollout，以及每条 rollout 的 state revisions、测试 freshness、最终声明和 reward components。它的价值是让 exploit 与 verifier 响应变得可检查、可回归测试，而不是宣称模型性能。

这些 scripted policies 是**确定性 fixtures**：它们使用预先定义的动作序列验证环境与 reward contract 是否按设计工作。它们不是 LLM 实验、不是训练结果，也不能支持关于模型可靠性、泛化能力或线上效果的结论。

建议演示顺序：

1. 运行 `honest`，展示产物修改、当前 revision 上测试通过、状态一致的提交以及分解 reward。
2. 运行 `false_claimer`，展示没有工具证据的成功声明不会获得任务完成 reward。
3. 运行 `stale_test_exploiter`，展示测试后再次写入会让先前测试失效。
4. 打开转换后的 structured trace，说明同一条 rollout 如何进入 AgentEval 做辅助 failure analysis。

## 可信度边界

v0 能证明的是：我实现了一个有状态的 action/transition loop、确定性 verifier、可审计 reward、exploit probes，以及从 environment rollout 到 evaluation trace 的连接。

v0 不能证明的是：任何真实模型已经在这些任务上取得某个成功率；reward 权重是最优的；系统已经通过真人验证；它适合 frontier-scale training；或 AgentEval 能提升模型表现。当前任务很小，状态完全在内存中，scripted policies 也知道用于生成 fixture 的 reference solution。

## English resume bullets

- Built a deterministic, Gym-like agent reliability environment with stateful file tools, revision-aware tests, terminal verification, and decomposed rewards for artifact correctness, fresh execution evidence, and structured report/state alignment.
- Designed reproducible exploit probes for false completion claims, stale test evidence, and wrong-path shortcuts, separating deterministic environment fixtures from model-performance experiments.
- Integrated environment rollouts with AgentEval's versioned structured-trace pipeline, preserving tool calls, verified state transitions, and provenance for auxiliary behavioral analysis.

## 60-second interview pitch

> AgentEval originally focused on evaluating an agent after a trace already existed. I wanted to close the gap between trace evaluation and an RL-style environment, so I built a small deterministic environment where an agent must edit virtual files, run revision-aware tests, and submit a final report. The terminal reward comes from an independent verifier: it checks the artifact, whether tests passed on the current state, and whether the final claim matches that state. I also added scripted exploit fixtures, such as claiming completion without acting or changing the state after tests pass. Those fixtures are not model results; they regression-test the environment contract. Finally, every rollout is converted into AgentEval's structured trace format, so the same episode has both a verifiable task reward and an auxiliary behavioral evaluation path. The next experiment is to hold the tasks and verifier fixed, replace the fixtures with a real model policy, and report preregistered task-success and failure-mode results.

## 下一步：model-driven policy 实验

下一阶段只替换 policy，不改任务与 verifier。给一个真实模型相同的 observation 和四个动作工具，让它完成 frozen task set；scripted policies 继续作为环境 regression fixtures，而不是实验 baseline 的替身。

在运行前固定：模型与版本、prompt、最大步数、采样参数、任务划分、重试/失败规则、主要指标和报告模板。至少报告：verified task success、reward components、false-completion rate、stale-test citation rate、步骤数、token/latency/cost，以及每个失败 episode 的 trace。AgentEval 的辅助判断应与 verifier reward 分开报告，先分析二者何时一致或分歧，再讨论是否值得扩展任务或用于训练。真人验证可以作为后续外部 validity 工作，但不应被写成 v0 已完成的证据。
