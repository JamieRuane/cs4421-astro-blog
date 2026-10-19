import { describe, expect, it } from 'vitest';
import { WORDLE_ANSWERS, WORDLE_VALID_GUESSES } from '../data/wordleWords';
import { evaluateWordleGuess, isValidWordleGuess } from './wordle';

describe('Wordle game logic', () => {
	it('marks exact letters green and misplaced letters yellow', () => {
		expect(evaluateWordleGuess('crane', 'trace')).toEqual([
			'absent',
			'correct',
			'correct',
			'present',
			'correct',
		]);
	});

	it('does not award more repeated letters than the answer contains', () => {
		expect(evaluateWordleGuess('civic', 'vivid')).toEqual([
			'absent',
			'correct',
			'correct',
			'correct',
			'absent',
		]);
		expect(evaluateWordleGuess('apple', 'allee')).toEqual([
			'correct',
			'present',
			'absent',
			'absent',
			'correct',
		]);
		expect(evaluateWordleGuess('crane', 'eerie')).toEqual([
			'absent',
			'absent',
			'present',
			'absent',
			'correct',
		]);
	});

	it('uses a fixed answer deterministically for unit tests', () => {
		expect(evaluateWordleGuess('crane', 'crane')).toEqual(Array(5).fill('correct'));
	});

	it('only accepts five-letter words from the local guess list', () => {
		const validWords = new Set(['crane', 'civic']);
		expect(isValidWordleGuess('CRANE', validWords)).toBe(true);
		expect(isValidWordleGuess('hello', validWords)).toBe(false);
		expect(isValidWordleGuess('cranes', validWords)).toBe(false);
	});

	it('keeps every answer five letters and valid as a guess', () => {
		expect(WORDLE_ANSWERS.length).toBeGreaterThan(1);
		for (const answer of WORDLE_ANSWERS) {
			expect(answer).toMatch(/^[a-z]{5}$/);
			expect(WORDLE_VALID_GUESSES.has(answer)).toBe(true);
		}
		expect([...WORDLE_VALID_GUESSES].every((word) => /^[a-z]{5}$/.test(word))).toBe(true);
	});
});
