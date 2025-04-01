// Initialize chess.js and core variables
const chess = new Chess();
let board = null;
let stockfish = null;
let engineReady = false;
let computerColor = null;
let rawLastPositionScore = null;
const blunderThreshold = 2.0;

// Mapping between skill level and approximate Elo
const skillToElo = [
    600, 800, 1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700,
    1800, 1900, 2000, 2100, 2200, 2300, 2400, 2500, 2600, 2700, 2800
];

// Initialize Stockfish
function initializeStockfish() {
    try {
        stockfish = new Worker('stockfish.js');
        
        stockfish.onmessage = function(event) {
            const message = event.data;
            
            if (message === 'uciok') {
                stockfish.postMessage('setoption name Skill Level value 20');
                stockfish.postMessage('isready');
            } 
            else if (message === 'readyok') {
                engineReady = true;
                document.getElementById('feedback').textContent = 'Chess engine ready!';
            }
        };
        
        stockfish.postMessage('uci');
        return stockfish;
    } catch (error) {
        console.error('Stockfish initialization error:', error);
        document.getElementById('feedback').textContent = 'Failed to initialize chess engine';
        return null;
    }
}

// Core game movement functions
function onDragStart(source, piece) {
    if (chess.game_over()) return false;
    return (chess.turn() === 'w' && piece.search(/^b/) === -1) ||
           (chess.turn() === 'b' && piece.search(/^w/) === -1);
}

function onDrop(source, target) {
    const prevFen = chess.fen();
    const move = chess.move({
        from: source,
        to: target,
        promotion: 'q'
    });

    if (move === null) return 'snapback';

    board.position(chess.fen());
    removeArrows();
    
    // Always evaluate position after a move
    evaluatePosition(function(rawScoreAfter) {
        // Display the score from player's perspective
        displayScore(rawScoreAfter);
        
        if (rawLastPositionScore !== null) {
            checkForBlunder(rawLastPositionScore, rawScoreAfter, prevFen);
        }
        
        // Store the raw score for next comparison
        rawLastPositionScore = rawScoreAfter;
    updateStatus();
        
        // Make computer move if it's computer's turn
        if (computerColor && computerColor === chess.turn() && !chess.game_over()) {
            setTimeout(makeComputerMove, 500);
        }
    });
}

function onSnapEnd() {
    board.position(chess.fen());
}

// Position evaluation function
function evaluatePosition(callback) {
    if (!stockfish || !engineReady) {
        if (callback) callback(null);
        return;
    }
    
    let evaluation = null;
    let depth = 0;
    
    const originalHandler = stockfish.onmessage;
    stockfish.onmessage = function(event) {
        const response = event.data;
        
        if (response.includes('info') && response.includes('score')) {
            console.log('Raw Stockfish response:', response);
            
            // Parse FEN components
            const fen = chess.fen();
            const [position, activeColor, castling, enPassant, halfmove, fullmove] = fen.split(' ');
            
            // Determine player's color
            const playerColor = computerColor === 'w' ? 'b' : 'w';
            
            const depthMatch = /depth (\d+)/.exec(response);
            if (depthMatch && parseInt(depthMatch[1]) > depth) {
                depth = parseInt(depthMatch[1]);
                
                if (response.includes('score mate')) {
                    const scoreMatch = /score mate ([+-]?\d+)/.exec(response);
                    if (scoreMatch) {
                        const mateInN = parseInt(scoreMatch[1]);
                        
                        // Determine if current side to move is winning or losing
                        const sideToMoveIsWinning = mateInN > 0;
                        
                        // Determine if the current side to move is the player or computer
                        const isPlayerTurn = chess.turn() === playerColor;
                        
                        // Set score based on whether player is winning or losing
                        if (isPlayerTurn) {
                            // Player's turn
                            evaluation = sideToMoveIsWinning ? 9900 : -9900;
                        } else {
                            // Computer's turn
                            evaluation = sideToMoveIsWinning ? -9900 : 9900;
                        }
                        
                        console.log('Mate detected:', {
                            mateInN: mateInN,
                            whoseTurn: chess.turn(),
                            playerColor: playerColor,
                            sideToMoveIsWinning: sideToMoveIsWinning,
                            isPlayerTurn: isPlayerTurn,
                            finalScore: evaluation
                        });
                    }
                } else {
                    const scoreMatch = /score cp ([+-]?\d+)/.exec(response);
                    if (scoreMatch) {
                        evaluation = parseInt(scoreMatch[1]) / 100;
                        console.log('Position evaluation:', {
                            rawCentipawns: scoreMatch[1],
                            convertedToPawns: evaluation,
                            whoseTurn: chess.turn(),
                            playerColor: playerColor,
                            isPlayerTurn: chess.turn() === playerColor
                        });
                        
                        // Convert score if the current turn is not the player's
                        if (chess.turn() !== playerColor) {
                            evaluation = -evaluation;
                            console.log('Converting score to player perspective:', evaluation);
                        }
                    }
                }
            }
        } 
        else if (response.includes('bestmove')) {
            stockfish.onmessage = originalHandler;
            if (callback) callback(evaluation);
        }
    };
    
    console.log('Sending position to Stockfish:', {
        fen: chess.fen(),
        whoseTurn: chess.turn(),
        playerColor: computerColor === 'w' ? 'b' : 'w',
        command: 'position fen ' + chess.fen()
    });
    
    stockfish.postMessage('stop');
    stockfish.postMessage('position fen ' + chess.fen());
    stockfish.postMessage('go depth 15 movetime 1000');
}

// Blunder detection and suggestion
function checkForBlunder(rawScoreBefore, rawScoreAfter, positionFen) {
    if (rawScoreBefore === null || rawScoreAfter === null) return;
    
    const colorJustMoved = chess.turn() === 'w' ? 'b' : 'w';
    const isHumanMove = colorJustMoved !== computerColor;
    
    if (!isHumanMove) {
        removeArrows();
        return;
    }
    
    // Scores are already in player's perspective
    const playerScoreBefore = rawScoreBefore;
    const playerScoreAfter = rawScoreAfter;
    
    // Calculate evaluation change
    let evalChange = playerScoreBefore - playerScoreAfter;
    
    if (Math.abs(playerScoreAfter) >= 9000) {
        evalChange = (playerScoreAfter < 0) ? 10000 : -10000;
    }
    
    const isBlunderMove = evalChange >= blunderThreshold;
    
    if (isBlunderMove) {
        findBetterMove(positionFen, function(betterMove) {
            if (betterMove) {
                document.getElementById('feedback').textContent = 
                    `Blunder detected! A better move would be: ${betterMove}`;
                drawArrow(betterMove.substring(0, 2), betterMove.substring(2, 4));
            }
        });
    } else {
        removeArrows();
        updateStatus();
    }
}

// Move suggestion and computer moves
function findBetterMove(fen, callback) {
    if (!stockfish || !engineReady) {
        if (callback) callback(null);
        return;
    }
    
    const originalHandler = stockfish.onmessage;
    stockfish.onmessage = function(event) {
        const response = event.data;
        
        if (response.includes('bestmove')) {
            stockfish.onmessage = originalHandler;
            
            const match = response.match(/bestmove\s+(\w+)/);
            if (match && match[1] && match[1] !== '(none)') {
                callback(match[1]);
            } else {
                callback(null);
            }
        }
    };
    
    stockfish.postMessage('stop');
    stockfish.postMessage('position fen ' + fen);
    stockfish.postMessage('go depth 18 movetime 2000');
}

function makeComputerMove() {
    if (chess.game_over() || !computerColor || computerColor !== chess.turn()) return;
    
    document.getElementById('feedback').textContent = 'Computer is thinking...';
    
    evaluatePosition(function(rawScoreBefore) {
        // Set skill level
        const skillLevel = parseInt(document.getElementById('skill-slider').value);
        stockfish.postMessage('setoption name Skill Level value ' + skillLevel);
        
        // Listen for Stockfish's response
        const originalHandler = stockfish.onmessage;
        stockfish.onmessage = function(event) {
            if (event.data.includes('bestmove')) {
                const match = event.data.match(/bestmove\s+(\w+)/);
                
                if (match && match[1]) {
                    const computerMove = match[1];
                    const from = computerMove.substring(0, 2);
                    const to = computerMove.substring(2, 4);
                    const promotion = computerMove.length > 4 ? computerMove.substring(4, 5) : '';
                    
                    // Make the move
                    chess.move({
                        from: from,
                        to: to,
                        promotion: promotion || 'q'
                    });
                    
                    // Update display
                    removeArrows();
                    board.position(chess.fen());
                    
                    // Evaluate new position but DON'T store the score
                    evaluatePosition(function(rawScoreAfter) {
                        displayScore(rawScoreAfter);
                        // DO NOT update rawLastPositionScore here
                        updateStatus();
                    });
                }
                
                stockfish.onmessage = originalHandler;
            }
        };
        
        // Ask Stockfish for best move
        stockfish.postMessage('stop');
        stockfish.postMessage('position fen ' + chess.fen());
        stockfish.postMessage('go depth 10 movetime 1000');
    });
}

// UI Functions
function drawArrow(from, to) {
    removeArrows();
    
    const arrow = document.createElement('div');
    arrow.className = 'move-arrow';
    document.querySelector('#board').appendChild(arrow);
    
    const fromSquare = document.querySelector(`.square-${from}`);
    const toSquare = document.querySelector(`.square-${to}`);
    
    if (!fromSquare || !toSquare) return;
    
    const boardElement = document.querySelector('#board');
    const fromRect = fromSquare.getBoundingClientRect();
    const toRect = toSquare.getBoundingClientRect();
    const boardRect = boardElement.getBoundingClientRect();
    
    const fromX = fromRect.left + fromRect.width/2 - boardRect.left;
    const fromY = fromRect.top + fromRect.height/2 - boardRect.top;
    const toX = toRect.left + toRect.width/2 - boardRect.left;
    const toY = toRect.top + toRect.height/2 - boardRect.top;
    
    const length = Math.sqrt(Math.pow(toX - fromX, 2) + Math.pow(toY - fromY, 2));
    const angle = Math.atan2(toY - fromY, toX - fromX) * 180 / Math.PI;
    
    arrow.style.position = 'absolute';
    arrow.style.width = `${length}px`;
    arrow.style.height = '10px';
    arrow.style.backgroundColor = 'rgba(0, 200, 0, 0.8)';
    arrow.style.left = `${fromX}px`;
    arrow.style.top = `${fromY}px`;
    arrow.style.transformOrigin = '0 50%';
    arrow.style.transform = `rotate(${angle}deg)`;
    arrow.style.zIndex = '1000';
    arrow.style.borderRadius = '4px';
    arrow.style.pointerEvents = 'none';
    arrow.style.animation = 'pulse 1.5s infinite';
    
    const arrowHead = document.createElement('div');
    arrowHead.className = 'arrow-head';
    arrow.appendChild(arrowHead);
    
    if (!document.getElementById('arrow-animation')) {
        const style = document.createElement('style');
        style.id = 'arrow-animation';
        style.textContent = `
            @keyframes pulse {
                0% { opacity: 0.7; }
                50% { opacity: 1; }
                100% { opacity: 0.7; }
            }
        `;
        document.head.appendChild(style);
    }
}

function removeArrows() {
    document.querySelectorAll('.move-arrow').forEach(arrow => arrow.remove());
}

function displayScore(rawScore) {
    if (rawScore === null) return;
    
    // Determine player's color
    const playerColor = computerColor === 'w' ? 'b' : 'w';
    
    // Score is already converted to player's perspective in evaluatePosition
    const playerScore = rawScore; // No need to convert again
    
    // Update evaluation text
    const evalText = document.getElementById('eval-text');
    if (evalText) {
        evalText.textContent = playerScore.toFixed(2);
        evalText.style.color = playerScore > 0.5 ? 'green' : 
                              playerScore < -0.5 ? 'red' : 'black';
    }
    
    // Update evaluation bar
    const evalBar = document.getElementById('eval-bar');
    if (evalBar) {
        const clampedScore = Math.max(-5, Math.min(5, playerScore));
        const percentage = ((clampedScore + 5) / 10) * 100;
        
        evalBar.style.height = percentage + '%';
        evalBar.style.bottom = '0';
        evalBar.style.backgroundColor = playerScore >= 0 ? '#4CAF50' : '#f44336';
    }

    // Update evaluation details panel
    document.getElementById('player-color').textContent = playerColor === 'w' ? 'White' : 'Black';
    
    // Previous score is also already in player's perspective
    const previousPlayerScore = rawLastPositionScore;
    
    document.getElementById('score-before').textContent = previousPlayerScore ? previousPlayerScore.toFixed(2) : '-';
    document.getElementById('score-after').textContent = playerScore.toFixed(2);
    
    // Calculate evaluation change
    if (previousPlayerScore !== null) {
        const evalChange = playerScore - previousPlayerScore;
        document.getElementById('eval-drop').textContent = 
            evalChange.toFixed(2) + (evalChange < 0 ? " (worsened)" : " (improved)");
    }
    
    // Debug logging
    console.log({
        rawScore: rawScore, // Now this is actually already converted
        playerColor: playerColor,
        playerScore: playerScore,
        rawLastPositionScore: rawLastPositionScore, // This is also already converted
        previousPlayerScore: previousPlayerScore
    });
}

function updateStatus() {
    let status = '';

    if (chess.game_over()) {
        if (chess.in_checkmate()) {
            status = 'Game over: ' + (chess.turn() === 'w' ? 'Black' : 'White') + ' wins by checkmate';
        } else {
            status = chess.in_draw() ? 'Game over: Draw' :
                    chess.in_stalemate() ? 'Game over: Stalemate' :
                    chess.in_threefold_repetition() ? 'Game over: Draw by repetition' :
                    chess.insufficient_material() ? 'Game over: Draw by insufficient material' :
                    'Game over';
        }
    } else {
        const currentTurn = chess.turn() === 'w' ? 'White' : 'Black';
        status = `${currentTurn} to move${chess.in_check() ? ', ' + currentTurn + ' is in check' : ''}`;
        if (computerColor === chess.turn()) {
            status += ' (Computer\'s turn)';
        }
    }

    document.getElementById('feedback').textContent = status;
}

// Game control functions
function changeSide(humanColor) {
    computerColor = (humanColor === 'w') ? 'b' : 'w';
    board.orientation(humanColor === 'w' ? 'white' : 'black');
    updateStatus();
    
    document.getElementById('feedback').textContent = 
        'Now playing as ' + (humanColor === 'w' ? 'White' : 'Black');
    
    if (computerColor === chess.turn() && !chess.game_over()) {
        setTimeout(makeComputerMove, 500);
    }
}

function resetGame() {
    chess.reset();
    rawLastPositionScore = null;
    removeArrows();
    
    const currentOrientation = board.orientation();
    board.position(chess.fen());
    computerColor = currentOrientation === 'white' ? 'b' : 'w';
    
    // Reset all score displays in the UI
    const evalText = document.getElementById('eval-text');
    if (evalText) {
        evalText.textContent = '0.00';
        evalText.style.color = 'black';
    }
    
    const evalBar = document.getElementById('eval-bar');
    if (evalBar) {
        evalBar.style.height = '50%';  // Neutral position (0.00)
        evalBar.style.backgroundColor = '#4CAF50';
    }
    
    document.getElementById('score-before').textContent = '-';
    document.getElementById('score-after').textContent = '0.00';
    document.getElementById('eval-drop').textContent = '0.00';
    
    updateStatus();
    
    document.getElementById('feedback').textContent = 
        'Game reset. You are playing as ' + (currentOrientation === 'white' ? 'White' : 'Black');
    
    if (computerColor === 'w' && currentOrientation === 'black') {
        setTimeout(makeComputerMove, 500);
    }
}

// Initialize everything
window.onload = function() {
    board = Chessboard('board', {
        draggable: true,
        position: 'start',
        onDragStart: onDragStart,
        onDrop: onDrop,
        onSnapEnd: onSnapEnd
    });
    
    document.getElementById('suggestButton').addEventListener('click', () => {
        if (!stockfish || !engineReady) {
            document.getElementById('feedback').textContent = 
                !stockfish ? 'Chess engine not initialized' : 'Chess engine is still initializing';
            return;
        }
        
        document.getElementById('feedback').textContent = 'Thinking...';
        findBetterMove(chess.fen(), function(suggestedMove) {
            if (suggestedMove) {
                document.getElementById('feedback').textContent = `Suggested move: ${suggestedMove}`;
                drawArrow(suggestedMove.substring(0, 2), suggestedMove.substring(2, 4));
            }
        });
    });
    
    document.getElementById('resetButton').addEventListener('click', resetGame);
    
    const skillSlider = document.getElementById('skill-slider');
    const eloDisplay = document.getElementById('elo-display');
    
    skillSlider.addEventListener('input', function() {
        const skillLevel = parseInt(this.value);
        eloDisplay.textContent = skillToElo[skillLevel];
        if (stockfish && engineReady) {
            stockfish.postMessage('setoption name Skill Level value ' + skillLevel);
        }
    });
    
    document.getElementById('select-white').addEventListener('click', function() {
        this.classList.add('selected-side');
        document.getElementById('select-black').classList.remove('selected-side');
        changeSide('w');
    });
    
    document.getElementById('select-black').addEventListener('click', function() {
        this.classList.add('selected-side');
        document.getElementById('select-white').classList.remove('selected-side');
        changeSide('b');
    });
    
    document.getElementById('select-white').classList.add('selected-side');
    computerColor = 'b';
    
    initializeStockfish();
    
    setTimeout(() => {
        evaluatePosition(function(rawScore) {
            displayScore(rawScore);
            rawLastPositionScore = rawScore;
        });
    }, 2000);
};
