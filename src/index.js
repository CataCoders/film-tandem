// 
//   ____  _____ _____ _    ____ _____ ___  ____    _____ _   _ ___ ____    ____  _     ____  _ 
//  |  _ \| ____|  ___/ \  / ___|_   _/ _ \|  _ \  |_   _| | | |_ _/ ___|  |  _ \| |   / ___|| |
//  | |_) |  _| | |_ / _ \| |     | || | | | |_) |   | | | |_| || |\___ \  | |_) | |   \___ \| |
//  |  _ <| |___|  _/ ___ \ |___  | || |_| |  _ <    | | |  _  || | ___) | |  __/| |___ ___) |_|
//  |_| \_\_____|_|/_/   \_\____| |_| \___/|_| \_\   |_| |_| |_|___|____/  |_|   |_____|____/(_)
//                                                                                              
// 

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
const visitedMoviesBySocketId = new Map()
const movieLikesByMovieId = new Map()

let currentTMDBPage = 1
let fetchedMovies = []

io.on('connection', async socket => {
  socketsById.set(socket.id, socket)
  visitedMoviesBySocketId.set(socket.id, 0)

  if (fetchedMovies.length === 0) {
    const movies = await fetchNewMoviesPage()

    fetchedMovies = [
      ...fetchedMovies,
      ...movies
    ]
  }
  
  await sendAllMoviesToClient(socket.id)

  socket.on('movie.like', movieId => {
    const movieLikes = getMovieLikes(movieId) 

    movieLikes.add(socket.id)
    setMovieLikes(movieId, movieLikes)
    clientVisitedMovie(socket.id, movieId)
    
    notifyMatches()
  });

  socket.on('movie.dislike', movieId => {
    clientVisitedMovie(socket.id, movieId)
  })

  socket.on('disconnect', () => {
    clientClear(socket.id)
    notifyMatches()
  })
});


const discoverMoviesPage = async pageNumber => {
  const parameters = {
    ott_region: 'ES',
    with_ott_providers: getOttProvidersByNames(
      'netflix',
      'hbo',
      'prime_video',
      'disney_plus'
    ),
    page: pageNumber
  }
  
  const { results } = await moviedb.discoverMovie(parameters)
  
  return results.map(formatMovieResult)
}

async function clientVisitedMovie(clientId, movieId) {
  increaseVisitedMovieCounter(clientId)

  if (shouldFetchMovies(clientId)) {
    const moreMovies = await fetchNewMoviesPage()
    fetchedMovies = [
      ...fetchedMovies,
      ...moreMovies
    ]

    sendMoviesToAll(moreMovies)
  }
}

function sendMoviesToAll(movies) {
  for (const targetSocket of socketsById.values()) {    
    targetSocket.emit('movie.list', JSON.stringify(movies));
  }
}

function shouldFetchMovies(clientId){
  return visitedMoviesBySocketId.get(clientId) % 18 === 0
}

function clientClear(clientId) {
  deleteUserIdFromLikes(clientId)
  deleteMoviesVisitedByClientId(clientId)
}

function deleteMoviesVisitedByClientId(clientId) {
  visitedMoviesBySocketId.delete(clientId)
}

function increaseVisitedMovieCounter(clientId) {
  const numberOfMovies = visitedMoviesBySocketId.get(clientId)
  visitedMoviesBySocketId.set(clientId, numberOfMovies + 1)
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
    const matchedMovieData = fetchedMovies.find(
      ({ id }) => id === matchedMovieId
    )

    broadcastMatch(
      JSON.stringify(matchedMovieData)
    )
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

async function fetchNewMoviesPage () {
  return discoverMoviesPage(currentTMDBPage++)
}

function sendAllMoviesToClient (clientId) {
  socketsById
    .get(clientId)
    .emit('movie.list', JSON.stringify(fetchedMovies))
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
