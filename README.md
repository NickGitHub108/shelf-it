Shelf-It
Project Leader: Nicholas MacDonald

Description: Shelf-It is a web app focused on logging content. Once content is logged, it will be shelved and displayed on your virtual bookshelf for you and others to look at.
My goal for this project is to build a social network for people who love sharing their thoughts on different content with their friends and people across the internet.
My main focus is logging different types of art: books, movies, TV, video games, and music.
Shelf-It is a hobby project I am using to maintain my web development skills after graduating.

Priority: Make a logging social media platform with shelving functionality. Render a shelf for users to view their logged content. 

Book Shelf
[ - ]
Game Shelf
[ - ]
Movie Shelf
[ - ]
TV Shelf
[ - ]
Music Shelf
[ - ]

## Catalog APIs

The navbar catalog search uses external APIs instead of seeded media:

- Books: Google Books when available, with Open Library as a fallback
- TV shows: TVmaze
- Music: iTunes Search
- Movies: TMDB when `TMDB_API_KEY` is configured, with iTunes and Wikimedia fallbacks

Set `TMDB_API_KEY` in the server environment for richer movie metadata. The key is read only on the server and is never sent to the browser.

