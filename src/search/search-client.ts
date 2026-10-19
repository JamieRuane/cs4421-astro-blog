import { searchItems, type SearchItem } from './search';

function isSearchItem(value: unknown): value is SearchItem {
	if (typeof value !== 'object' || value === null) {
		return false;
	}

	const item = value as Record<string, unknown>;
	return (
		typeof item.title === 'string' &&
		(item.type === 'Blog post' || item.type === 'Game' || item.type === 'Section') &&
		typeof item.description === 'string' &&
		typeof item.url === 'string' &&
		item.url.startsWith('/') &&
		!item.url.startsWith('//')
	);
}

function readIndex(root: HTMLElement): SearchItem[] {
	const serializedIndex = root.dataset.searchIndex;
	if (!serializedIndex) {
		throw new Error('Site search index is missing.');
	}

	const index: unknown = JSON.parse(serializedIndex);
	if (!Array.isArray(index) || !index.every(isSearchItem)) {
		throw new Error('Site search index contains invalid entries.');
	}
	return index;
}

document.querySelectorAll<HTMLElement>('[data-site-search]').forEach((root) => {
	const input = root.querySelector<HTMLInputElement>('[data-search-input]');
	const status = root.querySelector<HTMLElement>('[data-search-status]');
	const resultsList = root.querySelector<HTMLUListElement>('[data-search-results]');
	const clearButton = root.querySelector<HTMLButtonElement>('[data-search-clear]');
	const openButton = root.querySelector<HTMLButtonElement>('[data-search-open]');
	const dialog = root.querySelector<HTMLDialogElement>('[data-search-dialog]');
	const closeButtons = root.querySelectorAll<HTMLButtonElement>('[data-search-close]');

	if (!input || !status || !resultsList || !clearButton) {
		throw new Error('Site search markup is incomplete.');
	}

	const searchInput: HTMLInputElement = input;
	const searchStatus: HTMLElement = status;
	const searchResults: HTMLUListElement = resultsList;
	const searchClearButton: HTMLButtonElement = clearButton;
	const index = readIndex(root);

	function render(): void {
		const query = searchInput.value;
		searchResults.replaceChildren();
		searchClearButton.hidden = query.length === 0;

		if (query.trim().length === 0) {
			searchStatus.textContent = root.classList.contains('site-search-home')
				? 'Search blogs, games and sections.'
				: 'Type to find a blog, game or section.';
			return;
		}

		const results = searchItems(index, query);
		if (results.length === 0) {
			searchStatus.textContent = `No results for “${query.trim()}”. Try another search.`;
			return;
		}

		searchStatus.textContent = `${results.length} ${results.length === 1 ? 'result' : 'results'}`;
		results.forEach((item) => {
			const listItem = document.createElement('li');
			const link = document.createElement('a');
			const copy = document.createElement('span');
			const heading = document.createElement('span');
			const description = document.createElement('span');
			const type = document.createElement('span');

			copy.className = 'search-result-copy';
			heading.className = 'search-result-title';
			description.className = 'search-result-description';
			type.className = 'search-result-type';
			heading.textContent = item.title;
			description.textContent = item.description;
			type.textContent = item.type;
			copy.append(heading, description);
			link.href = item.url;
			link.append(copy, type);
			listItem.append(link);
			searchResults.append(listItem);
		});
	}

	searchInput.addEventListener('input', render);
	searchClearButton.addEventListener('click', () => {
		searchInput.value = '';
		render();
		searchInput.focus();
	});

	if (dialog && openButton) {
		openButton.addEventListener('click', () => {
			dialog.showModal();
			searchInput.focus();
		});

		closeButtons.forEach((button) => {
			button.addEventListener('click', () => dialog.close());
		});

		dialog.addEventListener('keydown', (event) => {
			if (event.key === 'Escape') {
				event.preventDefault();
				dialog.close();
			}
		});

		dialog.addEventListener('click', (event) => {
			if (event.target === dialog) {
				dialog.close();
			}
		});

		dialog.addEventListener('close', () => {
			openButton.focus();
		});

		document.addEventListener('keydown', (event) => {
			if (
				event.key === '/' &&
				!event.altKey &&
				!event.ctrlKey &&
				!event.metaKey &&
				!(event.target instanceof HTMLInputElement) &&
				!(event.target instanceof HTMLTextAreaElement) &&
				!(event.target instanceof HTMLElement && event.target.isContentEditable)
			) {
				event.preventDefault();
				dialog.showModal();
				searchInput.focus();
			}
		});
	}

	render();
});
