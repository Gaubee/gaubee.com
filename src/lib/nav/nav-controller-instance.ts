/**
 * NavController 单例与浏览器侧初始化。
 *
 * 从 controller.ts 拆出来，让 controller.ts 保持纯逻辑（可被 vitest 直接测试，
 * 不触发 `$app/environment` 与 window 副作用）。
 */
import { browser } from '$app/environment'
import { NavController } from './controller'

export const navController = new NavController()

if (browser) {
  navController.init()
}
