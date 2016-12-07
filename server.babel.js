let express = require('express');
let http = require('http');
let os = require('os');
let path = require('path');
let GAME_CONNECTOR = '___';
let app = express();
let favicon = require('serve-favicon');

// environments-----------------------------------------------------------------
app.set('port', process.env.PORT || 3000);

app.use(express.static(path.join(__dirname, 'public')));
app.use(favicon(path.join(__dirname, 'public', 'favicon.ico')));
app.get('/', function(req, res) {
    res.sendfile('public/index.html');
});

app.use(express.logger('dev'));
app.use(express.json());
app.use(express.urlencoded());

app.use(app.router);
http = http.createServer(app);

let io = require('socket.io')(http);
let gameRegistrar = [];
let players = [];

//listeners---------------------------------------------------------------------
io.on('connection', (socket) => {

    setupPlayerAndConnection(socket);

    socket.on('message', (msg) => {
        console.log(msg);
        socket.broadcast.to(socket.rooms[1]).emit('message', msg);
    });
    
    socket.on('requestGame', (data) => {

        let players = {
            requester: getPlayer(data.requestID),
            requestee: getPlayer(data.openPlayerID)
        };

        let game = new Game(players);
        gameRegistrar.push(game);
        game.players.forEach((player) => player.state = 'pending');

        function sendRequest() {
            io.emit('player_update', game.playerX);
            io.in(game.playerO.id).emit('request_to_join', game);
            io.emit('player_update', game.playerO);
        }

        if (playerInRoom(game.id, socket)) {
            sendRequest();
        }
        else {
            socket.join(game.id, () => sendRequest());
        }
    });

    socket.on('updatePlayerName', (nameData) => {
        let player = getPlayer(socket.id);
        player.playerName = nameData.name;
        io.emit('player_update', player);
    });

    socket.on('joinGame', (data) => {
        let gamePlaying = getGame(data.gameId);
        gamePlaying.state = 'live';

        if (playerInRoom(gamePlaying.id, socket)) {
            gamePlaying.startGame();
        }
        else {
            socket.join(gamePlaying.id, () => gamePlaying.startGame());
        }
    });

    socket.on('playTurn', (data) => {
        let gameId = data.gameId;
        let gamePlaying = getGame(gameId);

        if (data.player !== socket.id) {
            console.error('Something is Up!');
        }

        gamePlaying.completeTurn(getPlayer(data.player), [data.action.row, data.action.quad]);

        if (gamePlaying.isStalemate()) {
            io.in(gameId).emit('stale_mate', gamePlaying);
            io.in(gameId).emit('game_message', { message: 'Stale Mate!' });
            getGame(data.gameId).endGame();
        }
        else if (gamePlaying.isWinner()) {
            let gameCompleted = {
                game:gamePlaying,
                winner:getPlayer(socket.id)
            };

            io.in(gameId).emit('game_won', gameCompleted);
            getGame(gameId).endGame();
        }
        else {
            io.in(gameId).emit('turn_played', gamePlaying);
        }
    });

    socket.on('disconnect', () => {
        let playerDelete;
        cleanGameByPlayer(socket.id);

        for (let i = 0; i < players.length; ++i) {
            if (players[i].id === socket.id) {
                playerDelete = players[i];
                players.splice(i,1);
            }
        }

        playerDelete.playing = false;
        playerDelete.state = 'left';
        io.emit('player_update', playerDelete);
    });

    socket.on('chat_message', (msg) => {
        io.emit('chat_message', msg);
    });

    socket.on('ipaddr', () => {
        let ifaces = os.networkInterfaces();
        for (let dev in ifaces) {
            ifaces[dev].forEach((details) => {
                if (details.family === 'IPv4' && details.address !== '127.0.0.1') {
                    socket.emit('ipaddr', details.address);
                }
            });
        }
    });


});

http.listen(app.get('port'), function(){
    console.log('Express server listening on port ' + app.get('port'));
});

function setupPlayerAndConnection(socket) {
    let player = new Player(socket.id, socket.id, 0, 0, 0, 'new');
    players.push(player);
    socket.emit('available_games', players);
    io.emit('player_update', player);
}

function cleanGameByPlayer(playerId) {
    for (let i = 0; i < gameRegistrar.length; ++i) {
        let playerIds = gameRegistrar[i].id.split(GAME_CONNECTOR);

        if (playerIds[0] === playerId || playerIds[1] === playerId) {
            gameRegistrar.splice(i,1);
        }
    }
}

function getPlayer(playerId) {
    for (let i = 0; i < players.length; ++i) {
        if (players[i].id === playerId) {
           return players[i];
        }
    }
    console.error("Error: No Player Found for " + playerId);
}

function getGame(gameId) {
    for (let i = 0; i < gameRegistrar.length; ++i) {
        if (gameRegistrar[i].id === gameId) {
            return gameRegistrar[i];
        }
    }
    console.error("Error: No Game Found for " + gameId );
    return null;
}

function playerInRoom(roomID, socket) {
    let check = false;
    socket.rooms.forEach((room) => {
        if (room === roomID) {
            return check = true;
        }
    });
    return check;
}

class Player {
    constructor(clientId, userName, wins, losses, stalemate, state) {
        this.id = clientId;
        this.state = state;

        if (userName !== undefined) {
            this.playerName = userName;
        }
        else {
            this.playerName = this.id;
        }

        this.wins = wins;
        this.losses = losses;
        this.stalemate = stalemate;
    }
}

class Game {
    constructor(playerList, id) {
        playerList.requester.icon = "X";
        this.playerX = playerList.requester;

        playerList.requestee.icon = "O";
        this.playerO = playerList.requestee;

        this.players = [this.playerX, this.playerO];

        this.currentPlayer = this.playerX;

        this.id = id != null ? id : this.playerX.id + GAME_CONNECTOR + this.playerO.id;
        this.board = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
        this.aiscore= [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
        this.stats = {
            x: { wins: 0, losses: 0, stale: 0 },
            o:{ wins:0, losses: 0, stale: 0 }
        };
        this.live = true;
    }

    startGame() {
        this.players.forEach((player) => {
            player.state = 'playing';
            io.emit('player_update', player);
        });

        io.in(this.id).emit('begin_game', this);
        io.in(this.playerX.id).emit('game_message', { message: 'Game Started, You go First' });
        io.in(this.playerO.id).emit('game_message', { message: 'Game Started, Other Player Thinking' });
    }

    endGame() {
        this.players.forEach((player) => {
            player.state = 'new';
            io.emit('player_update', player);
        });
        this.cleanGame();
    }

    cleanGame() {
        for (let i = 0; i < gameRegistrar.length; ++i) {
            if (gameRegistrar[i].gameId === this.gameId) {
                gameRegistrar.splice(i, 1);
                break;
            }
        }
    }

    isStalemate() {
        if (gameDone(this.board).result === 'stalemate') {
            if (this.live) {
                ++this.stats.x.stale;
                ++this.stats.o.stale;
                this.live = false;
            }
            return true;
        }
        return false;
    }

    isWinner() {
        let results = gameDone(this.board);
        if (results.result === 'winner') {
            if (this.live) {
                if (this.playerX.id === results.winner) {
                    ++this.stats.x.wins;
                    ++this.stats.o.losses;
                }
                else {
                    ++this.stats.x.losses;
                    ++this.stats.o.wins;
                }
                this.live = false;
            }
            return true;
        }
        return false;
    }

    completeTurn(player, location) {
        if (this.currentPlayer === player && player === this.playerX) {
            this.board[location[0]][location[1]] = this.playerX.id;
            this.currentPlayer = this.playerO;
        }
        else {
            this.board[location[0]][location[1]] = this.playerO.id;
            this.currentPlayer = this.playerX;
        }
    }
}

function gameDone(board) {
    for (let i = 0; i < 3; ++i) {
        let lastSquare = 0;
        for (let q = 0; q < 3; ++q) {
            if (q === 0) {
                if (board[i][q] === 0) {
                    break;
                }
                lastSquare = board[i][q];
            }
            else {
                if (board[i][q] === 0 || lastSquare !== board[i][q]) {
                    break;
                }
                lastSquare = board[i][q];
            }
            if (q === 2) {
                return { result: 'winner', winner: board[i][q] };
            }
        }
    }

    for (let i = 0; i < 3; ++i) {
        let lastSquare = 0;
        for (let q = 0; q < 3; ++q) {
            if (q === 0) {
                if (board[q][i] === 0) {
                    break;
                }
                lastSquare = board[q][i];
            }
            else {
                if (board[q][i] === 0 || lastSquare !== board[q][i]) {
                    break;
                }
                lastSquare = board[q][i];
            }
            if (q === 2) {
                return { result: 'winner', winner: board[q][i] };
            }
        }
    }

    if (board[0][0] !== 0 && (board[0][0] === board[1][1] && board[2][2] === board[1][1])) {
        return  { result:'winner', winner: board[0][0] };
    }

    if (board[0][2] !== 0 && board[0][2] === board[1][1] && board[2][0] === board[1][1]) {
        return  { result: 'winner', winner: board[1][1] };
    }

    let mate = true;
    for (let i = 0; i < 3; i++) {
        for (let q = 0; q < 3; q++) {
            if (board[i][q] === 0) {
                mate = false;
            }
        }
    }
    if (mate) {
        return { result: 'stalemate' };
    }

    return { result: 'live', winner:null };
}
