// Stable public surface for application callers. Implementations live in
// cohesive domain clients so platform and sync policies do not leak between them.
export * from './api/account.js';
export * from './api/people.js';
export * from './api/boards.js';
export * from './api/papers.js';
export * from './api/rooms.js';
export * from './api/notifications.js';
export * from './api/feedback.js';
export * from './api/admin.js';
