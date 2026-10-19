import { HANGMAN_WORDS } from '../data/hangmanWords';
import { createHangmanState, guessHangmanLetter } from './hangman';

function pickWord(excluding?: string) {
	const options = HANGMAN_WORDS.filter((entry) => entry.word !== excluding);
	const nextWord = options[Math.floor(Math.random() * options.length)];
	if (!nextWord) {
		throw new Error('The Hangman word list is empty.');
	}
	return nextWord;
}

function requiredElement<T extends Element>(root: ParentNode, selector: string): T {
	const element = root.querySelector<T>(selector);
	if (!element) {
		throw new Error(`Hangman markup is missing ${selector}.`);
	}
	return element;
}

const root = document.querySelector<HTMLElement>('[data-hangman]');

if (root) {
	const wordDisplay = requiredElement<HTMLElement>(root, '[data-word-display]');
	const statusDisplay = requiredElement<HTMLElement>(root, '[data-status]');
	const hintDisplay = requiredElement<HTMLElement>(root, '[data-hint-text]');
	const mistakesDisplay = requiredElement<HTMLElement>(root, '[data-mistakes]');
	const newRoundButton = requiredElement<HTMLButtonElement>(root, '[data-new-round]');
	const letterButtons = root.querySelectorAll<HTMLButtonElement>('[data-letter]');
	const parts = root.querySelectorAll<SVGElement>('[data-part]');
	let state = createHangmanState(pickWord());

	function render(message: string): void {
		const guessed = new Set(state.guessedLetters);
		wordDisplay.replaceChildren(
			...[...state.word].map((letter, index) => {
				const slot = document.createElement('span');
				const revealed = guessed.has(letter) || state.status === 'lost';
				slot.className = `hangman-slot${revealed ? ' is-revealed' : ''}`;
				slot.textContent = revealed ? letter : '';
				slot.setAttribute(
					'aria-label',
					revealed ? `Letter ${index + 1}: ${letter}` : `Letter ${index + 1}: hidden`,
				);
				return slot;
			}),
		);

		mistakesDisplay.textContent = String(state.mistakes);
		statusDisplay.textContent = message;
		hintDisplay.textContent = state.hint;

		letterButtons.forEach((button) => {
			const letter = button.dataset.letter ?? '';
			const wasGuessed = guessed.has(letter);
			button.disabled = wasGuessed || state.status !== 'playing';
			button.setAttribute('aria-pressed', String(wasGuessed));
			button.classList.toggle('is-correct', wasGuessed && state.word.includes(letter));
			button.classList.toggle('is-incorrect', wasGuessed && !state.word.includes(letter));
		});

		parts.forEach((part, index) => {
			part.classList.toggle('is-hidden', index >= state.mistakes);
		});
	}

	function makeGuess(letter: string): void {
		const normalizedLetter = letter.toUpperCase();
		const nextState = guessHangmanLetter(state, normalizedLetter);
		if (nextState === state) {
			return;
		}

		state = nextState;
		if (state.status === 'won') {
			render('You got it! Start another round whenever you like.');
		} else if (state.status === 'lost') {
			render(`Out of guesses. The word was ${state.word}. Try another?`);
		} else if (state.word.includes(normalizedLetter)) {
			render(`Good guess: ${normalizedLetter}.`);
		} else {
			render(`Not in the word: ${normalizedLetter}.`);
		}
	}

	letterButtons.forEach((button) => {
		button.addEventListener('click', () => makeGuess(button.dataset.letter ?? ''));
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
		if (/^[a-z]$/i.test(event.key)) {
			event.preventDefault();
			makeGuess(event.key);
		}
	});

	newRoundButton.addEventListener('click', () => {
		state = createHangmanState(pickWord(state.word));
		render('Choose a letter to begin.');
	});

	render('Choose a letter to begin.');
}
