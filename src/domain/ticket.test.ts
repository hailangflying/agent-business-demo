/** 工单金额策略的边界测试，防止阈值比较在后续修改中发生回归。 */
import assert from "node:assert/strict";
import test from "node:test";
import {decideTicket, type Ticket} from "./ticket.js";

// 测试只关心金额，使用工厂函数生成其余固定字段。
const ticket = (amount: number): Ticket => ({id: 1, title: "测试工单", amount, status: "待处理"});

test("低于阈值时可以直接答复", () => {
    assert.equal(decideTicket(ticket(999), 1000).kind, "direct_reply");
});

test("等于阈值时必须进入人工审核", () => {
    assert.equal(decideTicket(ticket(1000), 1000).kind, "manual_review_required");
});

test("高于阈值时必须进入人工审核", () => {
    assert.equal(decideTicket(ticket(2000), 1000).kind, "manual_review_required");
});

test("拒绝非法金额", () => {
    assert.throws(() => decideTicket(ticket(-1), 1000), /工单金额/);
});
