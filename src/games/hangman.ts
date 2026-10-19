import type { HangmanWord } from '../data/hangmanWords';

export const MAX_HANGMAN_MISTAKES = 6;

export type HangmanStatus = 'playing' | 'won' | 'lost';

export interface HangmanState {
	word: string;
	hint: string;
	guessedLetters: string[];
	mistakes: number;
	status: HangmanStatus;
}

export function createHangmanState(entry: HangmanWord): HangmanState {
	const word = entry.word.toUpperCase();
	if (!/^[A-Z]+$/.test(word)) {
		throw new Error('Hangman words must contain only letters A–Z.');
	}

	return {
		word,
		hint: entry.hint,
		guessedLetters: [],
		mistakes: 0,
		status: 'playing',
	};
}

export function guessHangmanLetter(state: HangmanState, input: string): HangmanState {
	const letter = input.toUpperCase();
	if (state.status !== 'playing' || !/^[A-Z]$/.test(letter) || state.guessedLetters.includes(letter)) {
		return state;
	}

	const guessedLetters = [...state.guessedLetters, letter];
	const isCorrect = state.word.includes(letter);
	const mistakes = state.mistakes + (isCorrect ? 0 : 1);
	const hasWon = [...state.word].every((character) => guessedLetters.includes(character));

	return {
		...state,
		guessedLetters,
		mistakes,
		status: hasWon ? 'won' : mistakes >= MAX_HANGMAN_MISTAKES ? 'lost' : 'playing',
	};
}
