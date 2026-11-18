// Hanya untuk development lokal. Di Vercel yang dipakai adalah api/index.js
require('./api/index.js').listen(process.env.PORT || 3000, () => console.log('http://localhost:' + (process.env.PORT || 3000)));
