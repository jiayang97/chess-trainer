// Initialize chess.js and core variables
const chess = new Chess();
let board = null;
let stockfish = null;
let engineReady = false;
let computerColor = null;
let rawLastPositionScore = null;
let preBlunderScore = null; // Add variable to store pre-blunder evaluation
const blunderThreshold = 1.5; // Adjust this value to change the blunder detection threshold

// Mapping between skill level and approximate Elo
const skillToElo = [
    600, 800, 1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700,
    1800, 1900, 2000, 2100, 2200, 2300
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
                document.getElementById('computer-thinking').textContent = 'Choose your side to begin';
            }
        };
        
        stockfish.postMessage('uci');
        return stockfish;
    } catch (error) {
        console.error('Stockfish initialization error:', error);
        document.getElementById('computer-thinking').textContent = 'Failed to initialize chess engine';
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
    
    // Store the current evaluation before checking for blunder
    const currentEval = rawLastPositionScore;
    
    // Always evaluate position after a move
    evaluatePosition(function(rawScoreAfter) {
        // Display the score from player's perspective
        displayScore(rawScoreAfter);
        
        let blunderDetected = false;
        
        if (rawLastPositionScore !== null) {
            // Check if the move was a blunder
            const colorJustMoved = chess.turn() === 'w' ? 'b' : 'w';
            const isHumanMove = colorJustMoved !== computerColor;
            
            if (isHumanMove) {
                const playerScoreBefore = rawLastPositionScore;
                const playerScoreAfter = rawScoreAfter;
                let evalChange = playerScoreBefore - playerScoreAfter;
                
                if (Math.abs(playerScoreAfter) >= 9000) {
                    evalChange = (playerScoreAfter < 0) ? 10000 : -10000;
                }
                
                const isBlunderMove = evalChange >= blunderThreshold;
                
                if (isBlunderMove) {
                    blunderDetected = true;
                    preBlunderScore = currentEval; // Store the pre-blunder evaluation
                    // Find better move before computer's move
                    findBetterMove(prevFen, function(betterMove) {
                        if (betterMove) {
                            document.getElementById('blunder-feedback').innerHTML = 
                                `<span>Blunder detected!</span> A better move would be: ${betterMove}`;
                            document.getElementById('blunder-feedback').classList.add('blunder');
                            // Show undo button after blunder feedback
                            document.getElementById('undoButton').style.display = 'block';
                            // Show the feedback container
                            document.querySelector('.feedback-container').classList.add('visible');
                            
                            // Now make the computer move after showing blunder message
                            setTimeout(() => {
                                if (computerColor && computerColor === chess.turn() && !chess.game_over()) {
                                    setTimeout(makeComputerMove, 1500);
                                }
                            }, 2000);
                        }
                    });
                } else {
                    // Hide undo button if no blunder
                    document.getElementById('undoButton').style.display = 'none';
                    document.getElementById('blunder-feedback').textContent = '';
                    document.getElementById('blunder-feedback').classList.remove('blunder');
                    document.querySelector('.feedback-container').classList.remove('visible');
                    preBlunderScore = null; // Clear pre-blunder score if no blunder
                }
            }
        }
        
        // Store the raw score for next comparison
        rawLastPositionScore = rawScoreAfter;
        
        if (!blunderDetected) {
            updateStatus();
            
            // Make computer move if it's computer's turn
            if (computerColor && computerColor === chess.turn() && !chess.game_over()) {
                setTimeout(makeComputerMove, 500);
            }
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
                        
                        // Convert score if the current turn is not the player's
                        if (chess.turn() !== playerColor) {
                            evaluation = -evaluation;
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
    
    stockfish.postMessage('stop');
    stockfish.postMessage('position fen ' + chess.fen());
    stockfish.postMessage('go depth 15 movetime 1000');
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
    
    document.getElementById('computer-thinking').textContent = 'Computer is thinking...';
    
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
                    board.position(chess.fen());
                    updateStatus(); // Update status instead of clearing the message
                    
                    // Evaluate new position but DON'T store the score
                    evaluatePosition(function(rawScoreAfter) {
                        displayScore(rawScoreAfter);
                        // DO NOT update rawLastPositionScore here
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
function displayScore(rawScore) {
    if (rawScore === null) return;
    
    // Determine player's color
    const playerColor = computerColor === 'w' ? 'b' : 'w';
    
    // Score is already converted to player's perspective
    const playerScore = rawScore;
    
    // Update evaluation text
    const evalText = document.getElementById('eval-text');
    if (evalText) {
        evalText.textContent = playerScore.toFixed(2);
        evalText.style.color = playerScore > 0.5 ? '#666666' : 
                              playerScore < -0.5 ? 'red' : 'black';
    }
    
    // Update evaluation bar
    const evalBar = document.getElementById('eval-bar');
    if (evalBar) {
        const clampedScore = Math.max(-5, Math.min(5, playerScore));
        const percentage = ((clampedScore + 5) / 10) * 100;
        
        evalBar.style.height = percentage + '%';
        evalBar.style.bottom = '0';
        evalBar.style.backgroundColor = playerScore >= 0 ? '#666666' : '#f44336';
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
    }

    document.getElementById('computer-thinking').textContent = status;
}

// Game control functions
function changeSide(humanColor) {
    // Set computer color opposite to human color
    computerColor = humanColor === 'w' ? 'b' : 'w';
    
    // Set board orientation based on human color
    board.orientation(humanColor === 'w' ? 'white' : 'black');
    
    // Reset the game to ensure proper initialization
    chess.reset();
    board.position(chess.fen());
    
    // Reset evaluation scores
    rawLastPositionScore = null;
    
    updateStatus();
    
    // If computer is white, make the first move immediately
    if (computerColor === 'w') {
        // Wait for Stockfish to be ready
        if (engineReady) {
            setTimeout(makeComputerMove, 500);
        } else {
            // If Stockfish isn't ready yet, wait for it
            const checkEngine = setInterval(() => {
                if (engineReady) {
                    clearInterval(checkEngine);
                    setTimeout(makeComputerMove, 500);
                }
            }, 100);
        }
    }
}

function resetGame() {
    chess.reset();
    rawLastPositionScore = 0.00;  // Set initial score to 0.00
    
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
        evalBar.style.backgroundColor = '#666666';
    }
    
    document.getElementById('score-before').textContent = '0.00';
    document.getElementById('score-after').textContent = '0.00';
    document.getElementById('eval-drop').textContent = '0.00';
    
    // Clear blunder feedback and hide undo button
    document.getElementById('blunder-feedback').textContent = '';
    document.getElementById('blunder-feedback').classList.remove('blunder');
    document.getElementById('undoButton').style.display = 'none';
    document.querySelector('.feedback-container').classList.remove('visible');
    
    updateStatus();
    
    if (computerColor === 'w' && currentOrientation === 'black') {
        setTimeout(makeComputerMove, 500);
    }
}

// Add undo functionality
function undoLastMove() {
    // Undo computer's move if it was the last move
    if (chess.turn() !== computerColor) {
        chess.undo();
    }
    // Undo player's move
    chess.undo();
    
    // Update the board position
    board.position(chess.fen());
    
    // Hide the feedback container and clear blunder message
    document.querySelector('.feedback-container').classList.remove('visible');
    document.getElementById('blunder-feedback').textContent = '';
    document.getElementById('blunder-feedback').classList.remove('blunder');
    document.getElementById('undoButton').style.display = 'none';
    
    // Restore the pre-blunder evaluation
    if (preBlunderScore !== null) {
        rawLastPositionScore = preBlunderScore;
        displayScore(preBlunderScore);
        preBlunderScore = null; // Clear the stored pre-blunder score
    }
    
    updateStatus();
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
    
    // Initialize Stockfish first
    initializeStockfish();
    
    // Set up event listeners after Stockfish initialization
    const selectWhite = document.getElementById('select-white');
    const selectBlack = document.getElementById('select-black');
    
    selectWhite.addEventListener('click', function() {
        selectWhite.classList.add('selected-side');
        selectBlack.classList.remove('selected-side');
        changeSide('w');
    });
    
    selectBlack.addEventListener('click', function() {
        selectBlack.classList.add('selected-side');
        selectWhite.classList.remove('selected-side');
        changeSide('b');  // This will set computer as white and trigger its move
    });
    
    // Set initial state - default to white
    document.getElementById('select-white').classList.add('selected-side');
    changeSide('w');  // Initialize with white side selected
    
    document.getElementById('undoButton').addEventListener('click', undoLastMove);
    
    setTimeout(() => {
        evaluatePosition(function(rawScore) {
            displayScore(rawScore);
            rawLastPositionScore = rawScore;
        });
    }, 2000);
};
