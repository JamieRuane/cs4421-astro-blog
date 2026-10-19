export interface HangmanWord {
	word: string;
	hint: string;
}

export const HANGMAN_WORDS: HangmanWord[] = [
	{ word: 'MUSIC', hint: 'Tracks and artists worth discovering.' },
	{ word: 'CODING', hint: 'A creative part of software engineering.' },
	{ word: 'ASTRO', hint: 'The web framework behind this site.' },
	{ word: 'BLOGGING', hint: 'Writing and sharing ideas online.' },
	{ word: 'TECHNOLOGY', hint: 'An interest that keeps me curious.' },
	{ word: 'GAMES', hint: 'Little challenges and playful projects.' },
	{ word: 'MOVIES', hint: 'Films, from new releases to old favourites.' },
	{ word: 'TRAVEL', hint: 'Exploring different places.' },
	{ word: 'READING', hint: 'Finding stories and ideas in books.' },
	{ word: 'SOFTWARE', hint: 'The craft behind building applications.' },
];
