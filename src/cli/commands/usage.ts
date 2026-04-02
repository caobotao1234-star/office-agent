/**
 * `oa usage` — 查看 token 用量统计
 */
import { getTokenTracker } from '../agent-factory.js';

export function usage(): void {
  console.log(getTokenTracker().formatReport());
}
