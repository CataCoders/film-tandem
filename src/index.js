const path = require('path')

const app = require('express')();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const port = process.env.SERVER_PORT || 3000;
const { MovieDb } = require('moviedb-promise')
const moviedb = new MovieDb(process.env.MOVIEDB_API_KEY)

app.get('/', (req, res) => {
    const htmlFilePath = path.join(__dirname, '../public/index.html')
    res.sendFile(htmlFilePath);
});

const providerIdsByName = {
  netflix: '8',
  prime_video: '119',
  hbo: '118',
  disney_plus: '337'
}

const socketsById = new Map()
const movieLikesByMovieId = new Map()
let moviesList;

io.on('connection', async socket => {
  socketsById.set(socket.id, socket)
  moviesList = await discoverMovies()
  
  socket.on('movie.like', movieId => {
    const movieLikes = getMovieLikes(movieId) 

    movieLikes.add(socket.id)
    setMovieLikes(movieId, movieLikes)
    
    notifyMatches()
  });

  socket.on('disconnect', () => {
    deleteUserIdFromLikes(socket.id)
    notifyMatches()
  })
});


const discoverMovies = async () => {
  // Equivalant to { query: title }
  const parameters = {
    ott_region: 'ES',
    with_ott_providers: getOttProvidersByNames(
      'netflix',
      'hbo',
      'prime_video'
    ),
    page: 1
//    with_watch_providers: 'netflix',
//    watch_region: 'CA',
//    page: pageNum 
  }
  const { results, ...rest } = await moviedb.discoverMovie(parameters)
  
  return results
    .map(formatMovieResult)
}

function formatMovieResult ({ id, title, poster_path }) {
  return {
    id,
    title,
    posterUrl: getPosterUrlFormPath(poster_path)
  }
}

function getPosterUrlFormPath (path, width = 220, height = 330) {
  return `https://www.themoviedb.org/t/p/w${width}_and_h${height}_face${path}`
}

function getOttProvidersByNames (...providerNames) {
  return providerNames
    .map(
      providerName => providerIdsByName[providerName]
    )
    .join('|')
}

function notifyMatches() {
   const [matchedMovieId] = getMatches()
    
  if (matchedMovieId) {
    broadcastMatch(matchedMovieId)
  }
}

function deleteUserIdFromLikes(userId) {
  socketsById.delete(userId)

  for (const usersIdLiked of movieLikesByMovieId.values()) {
    usersIdLiked.delete(userId)
  }
}

function getMatches() {
  const numberOfParticipants = socketsById.size
  if (numberOfParticipants === 1) return []

  for (const [movieId, usersIdLiked] of movieLikesByMovieId.entries()) {
    if (usersIdLiked.size === numberOfParticipants) return [movieId]
  }

  return []
}

function sendMovieList(movies) {
  for (const targetSocket of socketsById.values()) {    
    targetSocket.emit('movie.list', JSON.stringify(movies));
  }
}

function getMovieLikes(movieId) {
  if (!movieLikesByMovieId.has(movieId)) return new Set()

  return movieLikesByMovieId.get(movieId)
}

function setMovieLikes(movieId, movieLikes) {
  movieLikesByMovieId.set(movieId, movieLikes)
}

function broadcastMatch (movieId) {
  for (const targetSocket of socketsById.values()) {    
    targetSocket.emit('movie.match', movieId);
  }
}

http.listen(port, () => {
  console.log(`Socket.IO server running at http://localhost:${port}/`);
});
