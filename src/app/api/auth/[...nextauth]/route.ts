import { handlers } from "@/auth";

/**
 * Auth.js route handler (docs/auth-design.md §3.6)
 *
 * GitHub OAuth のコールバック等、Auth.js が処理する全リクエストをここで受ける
 */
export const { GET, POST } = handlers;
