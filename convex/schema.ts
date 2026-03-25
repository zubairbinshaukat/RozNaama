import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({

  // Synced from Clerk on every sign-in
  users: defineTable({
    name:      v.string(),       // Display name from Clerk
    email:     v.string(),       // Unique, from Clerk
    createdAt: v.number(),       // Unix timestamp ms
  }).index('by_email', ['email']),

  // User-defined groupings for sales
  categories: defineTable({
    userId:    v.id('users'),    // Owner — always scoped
    name:      v.string(),       // e.g. "Electronics", "Food"
    color:     v.string(),       // Hex color string for UI badge
    createdAt: v.number(),
  }).index('by_userId', ['userId']),

  // One session = one modal submission containing multiple sale items
  saleSessions: defineTable({
    userId:      v.id('users'),
    totalAmount: v.number(),     // Sum of all sales.amount in this session
    itemCount:   v.number(),     // Number of sale items in this session
    sessionDate: v.number(),     // Unix ms — date of the session
    createdAt:   v.number(),
  }).index('by_userId_sessionDate', ['userId', 'sessionDate']),

  // Individual sale line items — one per product in a session
  sales: defineTable({
    userId:     v.id('users'),
    sessionId:  v.id('saleSessions'),         // Parent session
    categoryId: v.optional(v.id('categories')),
    productName: v.string(),                  // Name of item sold
    amount:      v.number(),                  // In PKR, always > 0
    note:        v.optional(v.string()),      // Optional short note
    saleDate:    v.number(),                  // Unix ms — when the sale happened
    createdAt:   v.number(),
  })
    .index('by_userId_saleDate',  ['userId', 'saleDate'])
    .index('by_userId_categoryId', ['userId', 'categoryId'])
    .index('by_sessionId',         ['sessionId']),

  // Expenses reduce your profit (shown on dashboard and per-day list)
  expenses: defineTable({
    userId:      v.id('users'),
    amount:      v.number(),        // In PKR, always > 0
    note:        v.optional(v.string()),
    expenseDate: v.number(),       // Unix ms — date of the expense
    createdAt:   v.number(),
  }).index('by_userId_expenseDate', ['userId', 'expenseDate']),

})
