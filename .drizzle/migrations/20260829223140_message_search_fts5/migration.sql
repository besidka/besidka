CREATE VIRTUAL TABLE `message_search` USING fts5(
	owner,
	body,
	body_stem,
	tokenize = 'unicode61 remove_diacritics 2'
);
