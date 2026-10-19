import { describe, expect, it } from 'vitest';
import { createHangmanState, guessHangmanLetter, MAX_HANGMAN_MISTAKES } from './hangman';

describe('Hangman game logic', () => {
	const word = { word: 'ASTRO', hint: 'The framework behind this site.' };

	it('tracks correct and incorrect guesses without counting duplicates', () => {
		const initial = createHangmanState(word);
		const correct = guessHangmanLetter(initial, 'a');
		const incorrect = guessHangmanLetter(correct, 'z');

		expect(correct.guessedLetters).toEqual(['A']);
		expect(correct.mistakes).toBe(0);
		expect(incorrect.mistakes).toBe(1);
		expect(guessHangmanLetter(incorrect, 'Z')).toBe(incorrect);
	});

	it('wins when all unique letters have been guessed', () => {
		const state = [...'ASTRO'].reduce(
			(current, letter) => guessHangmanLetter(current, letter),
			createHangmanState(word),
		);

		expect(state.status).toBe('won');
	});

	it('loses after the maximum number of incorrect guesses', () => {
		const state = [...'BCDEFG'].reduce(
			(current, letter) => guessHangmanLetter(current, letter),
			createHangmanState(word),
		);

		expect(state.mistakes).toBe(MAX_HANGMAN_MISTAKES);
		expect(state.status).toBe('lost');
		expect(guessHangmanLetter(state, 'A')).toBe(state);
	});
});
