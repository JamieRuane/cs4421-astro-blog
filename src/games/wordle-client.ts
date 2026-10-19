import { WORDLE_ANSWERS, WORDLE_VALID_GUESSES } from '../data/wordleWords';
import {
	evaluateWordleGuess,
	isValidWordleGuess,
	WORDLE_LENGTH,
	WORDLE_MAX_GUESSES,
	type LetterEvaluation,
} from './wordle';

function requiredElement<T extends Element>(root: ParentNode, selector: string): T {
	const element = root.querySelector<T>(selector);
	if (!element) {
		throw new Error(`Wordle markup is missing ${selector}.`);
	}
	return element;
}

const root = document.querySelector<HTMLElement>('[data-wordle]');

if (root) {
	const grid = requiredElement<HTMLElement>(root, '[data-wordle-grid]');
	const status = requiredElement<HTMLElement>(root, '[data-wordle-status]');
	const restartButton = requiredElement<HTMLButtonElement>(root, '[data-wordle-restart]');
	const keyboardButtons = root.querySelectorAll<HTMLButtonElement>('[data-key]');
	let answer = '';
	let guesses: string[] = [];
	let evaluations: ReturnType<typeof evaluateWordleGuess>[] = [];
	let currentGuess = '';
	let finished = false;

	function startGame(): void {
		const availableAnswers = WORDLE_ANSWERS.filter((word) => word !== answer);
		const answerPool = availableAnswers.length > 0 ? availableAnswers : WORDLE_ANSWERS;
		const nextAnswer = answerPool[Math.floor(Math.random() * answerPool.length)];
		if (!nextAnswer) {
			throw new Error('The Wordle answer list is empty.');
		}

		answer = nextAnswer;
		guesses = [];
		evaluations = [];
		currentGuess = '';
		finished = false;
		status.textContent = 'Enter a five-letter word to start.';
		render();
	}

	function render(): void {
		const tiles = grid.querySelectorAll<HTMLElement>('[data-row][data-column]');

		tiles.forEach((tile) => {
			const row = Number(tile.dataset.row);
			const column = Number(tile.dataset.column);
			const guessedWord = guesses[row];
			const letter = guessedWord?.[column] ?? (row === guesses.length ? currentGuess[column] : '');
			const evaluation = evaluations[row]?.[column];
			const evaluationLabel = evaluation
				? evaluation === 'correct'
					? 'correct position'
					: evaluation === 'present'
						? 'in the word, different position'
						: 'not in the word'
				: 'not submitted';

			tile.textContent = letter?.toUpperCase() ?? '';
			tile.classList.remove('is-correct', 'is-present', 'is-absent');
			if (evaluation) {
				tile.classList.add(`is-${evaluation}`);
			}
			tile.setAttribute(
				'aria-label',
				letter
					? `Guess ${row + 1}, letter ${column + 1}: ${letter}, ${evaluationLabel}`
					: `Guess ${row + 1}, letter ${column + 1}: empty`,
			);
		});

		const keyboardStates = new Map<string, LetterEvaluation>();
		const priority: Record<LetterEvaluation, number> = { absent: 1, present: 2, correct: 3 };
		guesses.forEach((guess, row) => {
			[...guess].forEach((letter, column) => {
				const evaluation = evaluations[row]?.[column];
				if (!evaluation) {
					throw new Error('Wordle guess feedback is missing.');
				}
				const previous = keyboardStates.get(letter);
				if (!previous || priority[evaluation] > priority[previous]) {
					keyboardStates.set(letter, evaluation);
				}
			});
		});

		keyboardButtons.forEach((button) => {
			const key = button.dataset.key ?? '';
			const state = keyboardStates.get(key.toLowerCase());
			button.disabled = finished;
			button.classList.remove('is-correct', 'is-present', 'is-absent');
			if (state) {
				button.classList.add(`is-${state}`);
				button.setAttribute(
					'aria-label',
					`${key}, ${state === 'correct' ? 'correct position' : state === 'present' ? 'in the word' : 'not in the word'}`,
				);
			} else {
				button.setAttribute(
					'aria-label',
					key === 'BACKSPACE' ? 'Delete last letter' : key === 'ENTER' ? 'Submit guess' : key,
				);
			}
		});
	}

	function submitGuess(): void {
		if (finished) {
			return;
		}
		if (currentGuess.length !== WORDLE_LENGTH) {
			status.textContent = 'Each guess must contain five letters.';
			return;
		}
		if (!isValidWordleGuess(currentGuess, WORDLE_VALID_GUESSES)) {
			status.textContent = `${currentGuess.toUpperCase()} is not in the word list.`;
			return;
		}

		const guess = currentGuess;
		const result = evaluateWordleGuess(answer, guess);
		guesses = [...guesses, guess];
		evaluations = [...evaluations, result];
		currentGuess = '';

		if (guess === answer) {
			finished = true;
			status.textContent = 'Brilliant — you found the word!';
		} else if (guesses.length === WORDLE_MAX_GUESSES) {
			finished = true;
			status.textContent = `No guesses left. The word was ${answer.toUpperCase()}.`;
		} else {
			status.textContent = `${WORDLE_MAX_GUESSES - guesses.length} guesses remaining.`;
		}
		render();
	}

	function handleKey(key: string): void {
		if (finished) {
			return;
		}
		if (key === 'ENTER') {
			submitGuess();
		} else if (key === 'BACKSPACE') {
			currentGuess = currentGuess.slice(0, -1);
			status.textContent = 'Enter a five-letter word.';
			render();
		} else if (/^[a-z]$/i.test(key) && currentGuess.length < WORDLE_LENGTH) {
			currentGuess += key.toLowerCase();
			status.textContent = 'Enter a five-letter word.';
			render();
		}
	}

	keyboardButtons.forEach((button) => {
		button.addEventListener('click', () => handleKey(button.dataset.key ?? ''));
	});
	root.addEventListener('pointerdown', () => root.focus({ preventScroll: true }));
	root.addEventListener('keydown', (event) => {
		if (
			event.altKey ||
			event.ctrlKey ||
			event.metaKey ||
			(event.target instanceof HTMLElement &&
				event.target.closest('input, textarea, select, [contenteditable="true"]'))
		) {
			return;
		}

		if (event.key === 'Enter') {
			event.preventDefault();
			handleKey('ENTER');
		} else if (event.key === 'Backspace') {
			event.preventDefault();
			handleKey('BACKSPACE');
		} else if (/^[a-z]$/i.test(event.key)) {
			event.preventDefault();
			handleKey(event.key);
		}
	});
	restartButton.addEventListener('click', startGame);

	startGame();
}
