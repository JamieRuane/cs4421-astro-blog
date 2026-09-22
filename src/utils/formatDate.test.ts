import { describe, expect, test } from "vitest";
import { formatDate } from "./formatDate";

describe("formatDate", () => {
    test("formats a date correctly", () => {
        const date = new Date("2026-09-22T12:00:00Z");

        expect(formatDate(date)).toBe("2026-09-22");
    });
});