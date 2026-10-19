export const WORDLE_LENGTH = 5;
export const WORDLE_MAX_GUESSES = 6;

export type LetterEvaluation = 'correct' | 'present' | 'absent';

export function evaluateWordleGuess(answer: string, guess: string): LetterEvaluation[] {
	const normalizedAnswer = answer.toLowerCase();
	const normalizedGuess = guess.toLowerCase();

	if (
		normalizedAnswer.length !== WORDLE_LENGTH ||
		normalizedGuess.length !== WORDLE_LENGTH ||
		!/^[a-z]{5}$/.test(normalizedAnswer) ||
		!/^[a-z]{5}$/.test(normalizedGuess)
	) {
		throw new Error('Wordle answers and guesses must be five letters A–Z.');
	}

	const result: LetterEvaluation[] = Array(WORDLE_LENGTH).fill('absent');
	const remainingLetters = new Map<string, number>();

	for (let index = 0; index < WORDLE_LENGTH; index++) {
		if (normalizedGuess[index] === normalizedAnswer[index]) {
			result[index] = 'correct';
		} else {
			const letter = normalizedAnswer[index];
			remainingLetters.set(letter, (remainingLetters.get(letter) ?? 0) + 1);
		}
	}

	for (let index = 0; index < WORDLE_LENGTH; index++) {
		if (result[index] === 'correct') {
			continue;
		}

		const letter = normalizedGuess[index];
		const count = remainingLetters.get(letter) ?? 0;
		if (count > 0) {
			result[index] = 'present';
			remainingLetters.set(letter, count - 1);
		}
	}

	return result;
}

export function isValidWordleGuess(guess: string, validWords: ReadonlySet<string>): boolean {
	return /^[a-z]{5}$/i.test(guess) && validWords.has(guess.toLowerCase());
}
