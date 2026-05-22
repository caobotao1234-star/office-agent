/**
 * `oa ask <问题>` — 单次提问，输出后退出
 */
import { getAgent } from '../agent-factory.js';
import { logger } from '../../core/logger.js';

export async function ask(question: string, modelOverride?: string): Promise<void> {
  logger.enableFileLogging();
  logger.setLevel((process.env['LOG_LEVEL'] as any) ?? 'info');
  const log = logger.child('CLI');
  const agent = getAgent(modelOverride);
  log.info('ask started', { modelOverride, questionLength: question.length });
  await agent.start();

  try {
    for await (const event of agent.handleMessage(question)) {
      switch (event.type) {
        case 'text':
          process.stdout.write(event.content);
          break;
        case 'tool_use':
          // 单次模式下静默工具调用
          break;
        case 'tool_result':
          break;
        case 'error':
          log.error('ask failed', { error: event.error });
          console.error(`\n❌ ${event.error}`);
          process.exit(1);
          break;
        case 'done':
          break;
      }
    }
    console.log(); // 结尾换行
  } finally {
    agent.stop();
  }
}
