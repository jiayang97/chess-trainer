// Initialize chess.js and core variables
const chess = new Chess();
let board = null;
let evaluationEngine = null;  // Strong engine for evaluation
let playingEngine = null;     // Engine for playing at selected ELO
let engineReady = false;
let computerColor = null;
let playerLastScore = null;   // Renamed from rawLastPositionScore to be more explicit
let preBlunderScore = null;
const blunderThreshold = 1.5;

// Mapping between skill level and approximate Elo
const skillToElo = [
    400, 600, 800, 1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900, 2000, 2100, 2200,
    2300
];

// Function to draw an arrow on the board
function drawArrow(from, to, color = '#495057') {
    // Remove any existing arrows
    clearArrows();
    
    // Get the board element
    const boardElement = document.getElementById('board');
    
    // Create SVG element if it doesn't exist
    let svg = document.getElementById('board-arrows');
    if (!svg) {
        svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('id', 'board-arrows');
        boardElement.appendChild(svg);
    }
    
    // Get the board's dimensions
    const boardWidth = boardElement.offsetWidth;
    const boardHeight = boardElement.offsetHeight;
    
    // Get the square size
    const squareSize = boardWidth / 8;
    
    // Get the board orientation
    const orientation = board.orientation();
    
    // Convert algebraic notation to coordinates based on orientation
    let fromFile, fromRank, toFile, toRank;
    
    if (orientation === 'white') {
        fromFile = from.charCodeAt(0) - 'a'.charCodeAt(0);
        fromRank = 8 - parseInt(from[1]);
        toFile = to.charCodeAt(0) - 'a'.charCodeAt(0);
        toRank = 8 - parseInt(to[1]);
    } else {
        fromFile = 7 - (from.charCodeAt(0) - 'a'.charCodeAt(0));
        fromRank = parseInt(from[1]) - 1;
        toFile = 7 - (to.charCodeAt(0) - 'a'.charCodeAt(0));
        toRank = parseInt(to[1]) - 1;
    }
    
    // Calculate center points of squares
    const fromX = (fromFile + 0.5) * squareSize;
    const fromY = (fromRank + 0.5) * squareSize;
    const toX = (toFile + 0.5) * squareSize;
    const toY = (toRank + 0.5) * squareSize;
    
    // Create arrow path
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    
    // Calculate arrow path
    const dx = toX - fromX;
    const dy = toY - fromY;
    const angle = Math.atan2(dy, dx);
    const length = Math.sqrt(dx * dx + dy * dy);
    
    // Adjust length to not overlap with pieces
    const adjustedLength = length * 0.95; // Reduce length by only 5% to make tail longer
    const adjustedToX = fromX + Math.cos(angle) * adjustedLength;
    const adjustedToY = fromY + Math.sin(angle) * adjustedLength;
    
    // Create arrow path
    const pathData = `M ${fromX} ${fromY} L ${adjustedToX} ${adjustedToY}`;
    path.setAttribute('d', pathData);
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', '10'); // Reduced from 15 to 10
    path.setAttribute('marker-end', `url(#arrowhead-${color})`);
    
    // Create arrowhead marker if it doesn't exist
    if (!document.getElementById(`arrowhead-${color}`)) {
        const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
        marker.setAttribute('id', `arrowhead-${color}`);
        marker.setAttribute('viewBox', '0 0 10 10');
        marker.setAttribute('refX', '5');
        marker.setAttribute('refY', '5');
        marker.setAttribute('markerWidth', '3'); // Make arrowhead smaller
        marker.setAttribute('markerHeight', '3'); // Make arrowhead smaller
        marker.setAttribute('orient', 'auto');
        
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
        path.setAttribute('fill', color);
        path.setAttribute('stroke', 'none'); // Remove stroke from arrowhead
        
        marker.appendChild(path);
        defs.appendChild(marker);
        svg.appendChild(defs);
    }
    
    svg.appendChild(path);
}

// Function to clear all arrows
function clearArrows() {
    const svg = document.getElementById('board-arrows');
    if (svg) {
        svg.innerHTML = '';
    }
}

// Initialize Stockfish instances
function initializeEngines() {
    try {
        // Initialize evaluation engine (strong)
        evaluationEngine = new Worker('stockfish.js');
        evaluationEngine.onmessage = function(event) {
            const message = event.data;
            if (message === 'uciok') {
                console.log('Evaluation engine ready');
                evaluationEngine.postMessage('setoption name Skill Level value 20'); // Max skill
                evaluationEngine.postMessage('setoption name Skill Level Maximum Error value 0');
                evaluationEngine.postMessage('setoption name Skill Level Probability value 0');
                evaluationEngine.postMessage('isready');
            } 
            else if (message === 'readyok') {
                console.log('Evaluation engine fully initialized');
            }
        };
        evaluationEngine.postMessage('uci');

        // Initialize playing engine (adjustable skill)
        playingEngine = new Worker('stockfish.js');
        playingEngine.onmessage = function(event) {
            const message = event.data;
            if (message === 'uciok') {
                console.log('Playing engine ready');
                // Set initial skill level
                const skillLevel = parseInt(document.getElementById('skill-slider').value);
                playingEngine.postMessage('setoption name Skill Level value ' + skillLevel);
                playingEngine.postMessage('setoption name Skill Level Maximum Error value 100');
                playingEngine.postMessage('setoption name Skill Level Probability value 100');
                playingEngine.postMessage('isready');
            } 
            else if (message === 'readyok') {
                engineReady = true;
                document.getElementById('computer-thinking').textContent = 'Engine Ready';
                const feedback = document.getElementById('blunder-feedback');
                if (feedback.textContent === 'Chess engine is still initializing') {
                    feedback.textContent = 'Engine Ready';
                }
            }
        };
        playingEngine.postMessage('uci');
        
        return true;
    } catch (error) {
        console.error('Engine initialization error:', error);
        document.getElementById('computer-thinking').textContent = 'Failed to initialize chess engine';
        return false;
    }
}

// Core game movement functions
function onDragStart(source, piece) {
    if (chess.game_over()) return false;
    return (chess.turn() === 'w' && piece.search(/^b/) === -1) ||
           (chess.turn() === 'b' && piece.search(/^w/) === -1);
}

function onDrop(source, target) {
    console.log('Drop event:', { source, target });
    
    // Clear any existing arrows when a new move is made
    clearArrows();
    
    const prevFen = chess.fen();
    const move = chess.move({
        from: source,
        to: target,
        promotion: 'q'
    });

    if (move === null) {
        console.log('Invalid move, returning snapback');
        return 'snapback';
    }

    console.log('Move made:', move);
    board.position(chess.fen());
    
    // Store the current evaluation before checking for blunder
    const scoreBefore = playerLastScore;
    console.log('Current evaluation before move:', scoreBefore);
    
    console.log('About to call evaluatePosition...');
    // Always evaluate position after a move
    evaluatePosition(function(rawScoreAfter) {
        console.log('Position evaluated in onDrop callback:', { 
            rawScoreAfter,
            scoreBefore,
            blunderThreshold
        });
        
        // Determine if this is a player move
        const colorJustMoved = chess.turn() === 'w' ? 'b' : 'w';
        const isPlayerMove = colorJustMoved !== computerColor;
        
        // For player moves, calculate and display the evaluation change
        if (isPlayerMove) {
            const evalChange = scoreBefore - rawScoreAfter;
            displayScore(rawScoreAfter, scoreBefore, evalChange);
        } else {
            // For computer moves, just display the last player's score
            displayScore(playerLastScore, playerLastScore, 0);
        }
        
        let blunderDetected = false;
        
        if (scoreBefore !== null) {
            console.log('Move analysis:', {
                colorJustMoved: colorJustMoved,
                computerColor: computerColor,
                isHumanMove: isPlayerMove,
                scoreBefore: scoreBefore,
                scoreAfter: rawScoreAfter
            });
            
            // Only check for blunders on human moves
            if (isPlayerMove) {
                const playerScoreBefore = scoreBefore;
                const playerScoreAfter = rawScoreAfter;
                let evalChange = playerScoreBefore - playerScoreAfter;
                
                if (Math.abs(playerScoreAfter) >= 9000) {
                    evalChange = (playerScoreAfter < 0) ? 10000 : -10000;
                }
                
                const isBlunderMove = evalChange >= blunderThreshold;
                
                console.log('Blunder check:', {
                    evalChange: evalChange,
                    threshold: blunderThreshold,
                    isBlunder: isBlunderMove,
                    before: playerScoreBefore,
                    after: playerScoreAfter,
                    isHumanMove: isPlayerMove
                });
                
                if (isBlunderMove) {
                    console.log('Blunder detected! Showing feedback...');
                    blunderDetected = true;
                    preBlunderScore = scoreBefore;
                    
                    // Show feedback container immediately
                    const feedbackContainer = document.querySelector('.feedback-container');
                    const blunderFeedback = document.getElementById('blunder-feedback');
                    const undoButton = document.getElementById('undoButton');
                    
                    console.log('Feedback elements:', {
                        feedbackContainer: feedbackContainer,
                        blunderFeedback: blunderFeedback,
                        undoButton: undoButton
                    });
                    
                    feedbackContainer.classList.add('visible');
                    blunderFeedback.innerHTML = `<span class="blunder-text">Blunder detected!</span><span style="color: #333;">Analyzing position...</span>`;
                    blunderFeedback.classList.add('blunder');
                    undoButton.style.display = 'block';
                    
                    console.log('Feedback container classes:', feedbackContainer.classList);
                    console.log('Blunder feedback classes:', blunderFeedback.classList);
                    
                    // Find better move before computer's move
                    findBetterMove(prevFen, function(betterMove) {
                        console.log('Better move found:', betterMove);
                        if (betterMove) {
                            blunderFeedback.innerHTML = 
                                `<span class="blunder-text">Blunder detected!</span><span style="color: #333;">A better move would be: ${betterMove}</span>`;
                            
                            // Add arrow for the recommended move
                            const from = betterMove.substring(0, 2);
                            const to = betterMove.substring(2, 4);
                            console.log('Drawing arrow:', { from, to });
                            drawArrow(from, to, '#d32f2f');
                            
                            // Now make the computer move after showing blunder message
                            setTimeout(() => {
                                if (computerColor && computerColor === chess.turn() && !chess.game_over()) {
                                    setTimeout(makeComputerMove, 1500);
                                }
                            }, 2000);
                        }
                    });
                } else {
                    console.log('No blunder detected');
                    // Hide feedback if no blunder
                    const feedbackContainer = document.querySelector('.feedback-container');
                    const blunderFeedback = document.getElementById('blunder-feedback');
                    const undoButton = document.getElementById('undoButton');
                    
                    feedbackContainer.classList.remove('visible');
                    blunderFeedback.textContent = '';
                    blunderFeedback.classList.remove('blunder');
                    undoButton.style.display = 'none';
                    preBlunderScore = 0;
                }
            } else {
                // For computer moves, ensure feedback is hidden
                const feedbackContainer = document.querySelector('.feedback-container');
                const blunderFeedback = document.getElementById('blunder-feedback');
                const undoButton = document.getElementById('undoButton');
                
                feedbackContainer.classList.remove('visible');
                blunderFeedback.textContent = '';
                blunderFeedback.classList.remove('blunder');
                undoButton.style.display = 'none';
                preBlunderScore = 0;
            }
        }
        
        // Update playerLastScore after all calculations are done
        playerLastScore = rawScoreAfter;
        
        if (!blunderDetected) {
            updateStatus();
            
            // Make computer move if it's computer's turn and game isn't over
            if (computerColor && computerColor === chess.turn() && !chess.game_over()) {
                setTimeout(makeComputerMove, 500);
            }
        }
    });
    console.log('evaluatePosition called, waiting for callback...');
}

function onSnapEnd() {
    board.position(chess.fen());
}

// Position evaluation function
function evaluatePosition(callback) {
    console.log('evaluatePosition called:', {
        evaluationEngine: !!evaluationEngine,
        engineReady,
        fen: chess.fen(),
        turn: chess.turn(),
        computerColor
    });

    if (!evaluationEngine || !engineReady) {
        console.log('Evaluation engine not ready:', { evaluationEngine: !!evaluationEngine, engineReady });
        if (callback) callback(0);
        return;
    }
    
    let evaluation = 0;
    let depth = 0;
    
    console.log('Starting position evaluation:', {
        fen: chess.fen(),
        turn: chess.turn(),
        computerColor: computerColor
    });
    
    const originalHandler = evaluationEngine.onmessage;
    evaluationEngine.onmessage = function(event) {
        const response = event.data;
        console.log('Evaluation engine response:', response);
        
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
                        
                        // Set score based on whether player is winning or losing
                        evaluation = sideToMoveIsWinning ? 9900 : -9900;
                        
                        // If it's not player's turn, flip the evaluation
                        if (chess.turn() !== playerColor) {
                            evaluation = -evaluation;
                        }
                        
                        console.log('Mate detected:', {
                            mateInN: mateInN,
                            whoseTurn: chess.turn(),
                            playerColor: playerColor,
                            sideToMoveIsWinning: sideToMoveIsWinning,
                            finalScore: evaluation
                        });

                        // Force update status when mate is detected
                        updateStatus();
                    }
                } else {
                    const scoreMatch = /score cp ([+-]?\d+)/.exec(response);
                    if (scoreMatch) {
                        const rawEval = parseInt(scoreMatch[1]) / 100;
                        
                        // Convert to player's perspective
                        evaluation = rawEval;
                        if (chess.turn() !== playerColor) {
                            evaluation = -evaluation;
                        }
                        
                        console.log('Position evaluation:', {
                            depth: depth,
                            rawEval: rawEval,
                            finalEval: evaluation,
                            whoseTurn: chess.turn(),
                            playerColor: playerColor
                        });
                    }
                }
            }
        } 
        else if (response.includes('bestmove')) {
            console.log('Evaluation complete:', {
                finalEval: evaluation,
                depth: depth
            });
            evaluationEngine.onmessage = originalHandler;
            if (callback) callback(evaluation);
        }
    };
    
    evaluationEngine.postMessage('stop');
    evaluationEngine.postMessage('position fen ' + chess.fen());
    evaluationEngine.postMessage('go depth 15 movetime 1000');
}

// Move suggestion and computer moves
function findBetterMove(fen, callback) {
    if (!evaluationEngine || !engineReady) {
        if (callback) callback(null);
        return;
    }
    
    const originalHandler = evaluationEngine.onmessage;
    evaluationEngine.onmessage = function(event) {
        const response = event.data;
        
        if (response.includes('bestmove')) {
            evaluationEngine.onmessage = originalHandler;
            
            const match = response.match(/bestmove\s+(\w+)/);
            if (match && match[1] && match[1] !== '(none)') {
                callback(match[1]);
            } else {
                callback(null);
            }
        }
    };
    
    evaluationEngine.postMessage('stop');
    evaluationEngine.postMessage('position fen ' + fen);
    evaluationEngine.postMessage('go depth 18 movetime 2000');
}

function makeComputerMove() {
    if (chess.game_over() || !computerColor || computerColor !== chess.turn()) return;
    
    const skillLevel = parseInt(document.getElementById('skill-slider').value);
    console.log('Making computer move with skill level:', skillLevel);
    
    // Set skill parameters for playing engine
    playingEngine.postMessage('setoption name Skill Level value ' + skillLevel);
    
    const maxError = Math.max(10, 100 - (skillLevel * 4));
    const probability = Math.max(10, 100 - (skillLevel * 4));
    
    playingEngine.postMessage('setoption name Skill Level Maximum Error value ' + maxError);
    playingEngine.postMessage('setoption name Skill Level Probability value ' + probability);
    
    console.log('Playing engine parameters:', { skillLevel, maxError, probability });
    
    const originalHandler = playingEngine.onmessage;
    playingEngine.onmessage = function(event) {
        if (event.data.includes('bestmove')) {
            const match = event.data.match(/bestmove\s+(\w+)/);
            
            if (match && match[1]) {
                const computerMove = match[1];
                const from = computerMove.substring(0, 2);
                const to = computerMove.substring(2, 4);
                const promotion = computerMove.length > 4 ? computerMove.substring(4, 5) : '';
                
                console.log('Computer move:', {
                    move: computerMove,
                    skillLevel: skillLevel,
                    elo: skillToElo[skillLevel]
                });
                
                chess.move({
                    from: from,
                    to: to,
                    promotion: promotion || 'q'
                });
                
                board.position(chess.fen());
                updateStatus();
                
                // Don't evaluate position or update score during computer's turn
                // Just keep showing the last player's score
                displayScore(playerLastScore);
            }
            
            playingEngine.onmessage = originalHandler;
        }
    };
    
    const depth = Math.max(3, Math.floor(skillLevel / 3));
    const moveTime = Math.max(100, 1000 - (skillLevel * 40));
    
    console.log('Playing engine search parameters:', { depth, moveTime });
    playingEngine.postMessage('stop');
    playingEngine.postMessage('position fen ' + chess.fen());
    playingEngine.postMessage('go depth ' + depth + ' movetime ' + moveTime);
}

// UI Functions
function displayScore(scoreAfter, scoreBefore, evalChange) {
    // Determine player's color and turn
    const playerColor = computerColor === 'w' ? 'b' : 'w';
    const isPlayerTurn = chess.turn() === playerColor;
    
    // Update evaluation text
    const evalText = document.getElementById('eval-text');
    if (evalText) {
        evalText.textContent = scoreAfter.toFixed(2);
        evalText.style.color = scoreAfter > 0.5 ? '#666666' : 
                              scoreAfter < -0.5 ? 'red' : 'black';
    }

    // Update evaluation details panel
    const playerColorElement = document.getElementById('player-color');
    if (playerColorElement) {
        playerColorElement.textContent = playerColor === 'w' ? 'White' : 'Black';
    }
    
    // Update score before
    const scoreBeforeElement = document.getElementById('score-before');
    if (scoreBeforeElement) {
        scoreBeforeElement.textContent = scoreBefore.toFixed(2);
    }
    
    // Update score after
    const scoreAfterElement = document.getElementById('score-after');
    if (scoreAfterElement) {
        scoreAfterElement.textContent = scoreAfter.toFixed(2);
    }
    
    // Update evaluation change
    const evalChangeElement = document.getElementById('eval-change');
    if (evalChangeElement) {
        evalChangeElement.textContent = evalChange.toFixed(2);
    }

    // Update blunder status
    const isBlunderElement = document.getElementById('is-blunder');
    if (isBlunderElement) {
        const isBlunder = evalChange <= -blunderThreshold;
        isBlunderElement.textContent = isBlunder ? "Yes" : "No";
        isBlunderElement.style.color = isBlunder ? "#d32f2f" : "#495057";
    }

    // Update thresholds display
    const thresholdsElement = document.getElementById('thresholds');
    if (thresholdsElement) {
        thresholdsElement.textContent = `Blunder: ${blunderThreshold}`;
    }
}

// Function to toggle evaluation metrics visibility
function toggleEvaluationMetrics() {
    const evalPanel = document.querySelector('.evaluation-panel');
    const toggleButton = document.getElementById('toggleEvalButton');
    
    if (evalPanel.classList.contains('visible')) {
        evalPanel.classList.remove('visible');
        toggleButton.textContent = 'Show Evaluation';
    } else {
        evalPanel.classList.add('visible');
        toggleButton.textContent = 'Hide Evaluation';
    }
}

function updateStatus() {
    let status = '';
    const statusElement = document.getElementById('computer-thinking');

    if (chess.game_over()) {
        if (chess.in_checkmate()) {
            status = 'Game over: ' + (chess.turn() === 'w' ? 'Black' : 'White') + ' wins by checkmate';
            statusElement.classList.add('checkmate');
            console.log('Checkmate detected:', status); // Debug log
        } else {
            status = chess.in_draw() ? 'Game over: Draw' :
                    chess.in_stalemate() ? 'Game over: Stalemate' :
                    chess.in_threefold_repetition() ? 'Game over: Draw by repetition' :
                    chess.insufficient_material() ? 'Game over: Draw by insufficient material' :
                    'Game over';
            statusElement.classList.remove('checkmate');
        }
    } else {
        const currentTurn = chess.turn() === 'w' ? 'White' : 'Black';
        const isComputerTurn = computerColor === chess.turn();
        status = `${currentTurn} to move${chess.in_check() ? ', ' + currentTurn + ' is in check' : ''}${isComputerTurn ? ' (Engine is thinking...)' : ''}`;
        statusElement.classList.remove('checkmate');
    }

    statusElement.textContent = status;
    console.log('Status updated:', status); // Debug log
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
    playerLastScore = null;
    
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
    playerLastScore = 0.00;  // Set initial score to 0.00
    
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
    document.getElementById('eval-change').textContent = '0.00';
    
    // Clear blunder feedback and hide undo button
    document.getElementById('blunder-feedback').textContent = '';
    document.getElementById('blunder-feedback').classList.remove('blunder');
    document.getElementById('undoButton').style.display = 'none';
    document.querySelector('.feedback-container').classList.remove('visible');
    
    // Clear any arrows on the board
    clearArrows();
    
    updateStatus();
    
    if (computerColor === 'w' && currentOrientation === 'black') {
        setTimeout(makeComputerMove, 500);
    }
}

// Add undo functionality
function undoLastMove() {
    console.log('Undoing last move, current turn:', chess.turn());
    
    // Store the current turn before undoing
    const turnBeforeUndo = chess.turn();
    
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
    
    // Clear any arrows on the board
    clearArrows();
    
    // Restore the pre-blunder evaluation
    if (preBlunderScore !== null) {
        playerLastScore = preBlunderScore;
        displayScore(preBlunderScore, preBlunderScore, 0);
        preBlunderScore = null; // Clear the stored pre-blunder score
    }
    
    updateStatus();
    
    // Only make computer move if it's computer's turn and computer is playing
    if (computerColor && chess.turn() === computerColor && !chess.game_over()) {
        console.log('Computer\'s turn after undo, making move');
        setTimeout(makeComputerMove, 500);
    } else {
        console.log('Not computer\'s turn after undo:', {
            computerColor: computerColor,
            currentTurn: chess.turn(),
            gameOver: chess.game_over()
        });
    }
}

// Initialize everything
window.onload = function() {
    console.log('Window loaded, initializing chessboard...');
    
    board = Chessboard('board', {
        draggable: true,
        position: 'start',
        onDragStart: function(source, piece) {
            console.log('Drag started:', { source, piece });
            return onDragStart(source, piece);
        },
        onDrop: function(source, target) {
            console.log('Drop event triggered:', { source, target });
            return onDrop(source, target);
        },
        onSnapEnd: function() {
            console.log('Snap end triggered');
            onSnapEnd();
        },
        showArrows: true,
        moveSpeed: 100,      // Faster piece movement
        trashSpeed: 50,      // Faster piece removal
        appearSpeed: 100,    // Faster piece appearance
        snapbackSpeed: 100,  // Faster snapback
        snapSpeed: 100       // Faster snapping
    });
    
    console.log('Chessboard initialized:', { board });
    
    // Add touch event handling
    const boardElement = document.getElementById('board');
    if (boardElement) {
        console.log('Adding touch event handlers to board element');
        boardElement.addEventListener('touchstart', function(e) {
            console.log('Touch start event');
            e.preventDefault();
        }, { passive: false });
        
        boardElement.addEventListener('touchmove', function(e) {
            console.log('Touch move event');
            e.preventDefault();
        }, { passive: false });
        
        boardElement.addEventListener('touchend', function(e) {
            console.log('Touch end event');
            e.preventDefault();
        }, { passive: false });
    } else {
        console.error('Board element not found!');
    }
    
    // Add event listener for evaluation toggle button
    const toggleButton = document.getElementById('toggleEvalButton');
    if (toggleButton) {
        console.log('Adding evaluation toggle button handler');
        toggleButton.addEventListener('click', toggleEvaluationMetrics);
    } else {
        console.error('Toggle evaluation button not found!');
    }
    
    // Add event listeners for info modal
    const modal = document.getElementById('infoModal');
    const infoButton = document.getElementById('infoButton');
    const closeButton = document.querySelector('.close-button');
    
    if (modal && infoButton && closeButton) {
        console.log('Adding modal event handlers');
        infoButton.addEventListener('click', function() {
            modal.classList.add('show');
        });
        
        closeButton.addEventListener('click', function() {
            modal.classList.remove('show');
        });
        
        window.addEventListener('click', function(event) {
            if (event.target === modal) {
                modal.classList.remove('show');
            }
        });
    } else {
        console.error('Modal elements not found!');
    }
    
    // Add skill slider handler
    const skillSlider = document.getElementById('skill-slider');
    const eloDisplay = document.getElementById('elo-display');
    
    if (skillSlider && eloDisplay) {
        console.log('Adding skill slider handler');
        skillSlider.addEventListener('input', function() {
            const skillLevel = parseInt(this.value);
            const eloValue = skillToElo[skillLevel];
            eloDisplay.textContent = eloValue;
            console.log('Skill level changed:', { skillLevel, eloValue });
            if (playingEngine && engineReady) {
                console.log('Sending skill level command to playing engine:', skillLevel);
                playingEngine.postMessage('setoption name Skill Level value ' + skillLevel);
                
                const maxError = Math.max(10, 100 - (skillLevel * 4));
                const probability = Math.max(10, 100 - (skillLevel * 4));
                
                playingEngine.postMessage('setoption name Skill Level Maximum Error value ' + maxError);
                playingEngine.postMessage('setoption name Skill Level Probability value ' + probability);
                
                console.log('Playing engine parameters set:', { skillLevel, maxError, probability });
            }
        });
    } else {
        console.error('Skill slider or ELO display not found!');
    }
    
    // Add reset button handler
    const resetButton = document.getElementById('resetButton');
    if (resetButton) {
        console.log('Adding reset button handler');
        resetButton.addEventListener('click', resetGame);
    } else {
        console.error('Reset button not found!');
    }
    
    // Add suggestion button handler
    const suggestButton = document.getElementById('suggestButton');
    if (suggestButton) {
        console.log('Adding suggestion button handler');
        suggestButton.addEventListener('click', () => {
            if (!evaluationEngine || !engineReady) {
                document.getElementById('blunder-feedback').textContent = 
                    !evaluationEngine ? 'Chess engine not initialized' : 'Chess engine is still initializing';
                document.querySelector('.feedback-container').classList.add('visible');
                return;
            }
            
            // Clear any existing arrows
            clearArrows();
            
            // Show feedback container and display thinking message
            document.querySelector('.feedback-container').classList.add('visible');
            document.getElementById('blunder-feedback').textContent = 'Thinking...';
            
            findBetterMove(chess.fen(), function(suggestedMove) {
                if (suggestedMove) {
                    document.getElementById('blunder-feedback').textContent = `Suggested move: ${suggestedMove}`;
                    // Add arrow for the suggested move
                    const from = suggestedMove.substring(0, 2);
                    const to = suggestedMove.substring(2, 4);
                    drawArrow(from, to); // Use default color (#495057)
                }
            });
        });
    } else {
        console.error('Suggestion button not found!');
    }
    
    // Initialize engines first
    console.log('Initializing chess engines...');
    initializeEngines();
    
    // Set up event listeners after Stockfish initialization
    const selectWhite = document.getElementById('select-white');
    const selectBlack = document.getElementById('select-black');
    
    if (selectWhite && selectBlack) {
        console.log('Adding side selection handlers');
        selectWhite.addEventListener('click', function() {
            selectWhite.classList.add('selected-side');
            selectBlack.classList.remove('selected-side');
            changeSide('w');
        });
        
        selectBlack.addEventListener('click', function() {
            selectBlack.classList.add('selected-side');
            selectWhite.classList.remove('selected-side');
            changeSide('b');
        });
    } else {
        console.error('Side selection buttons not found!');
    }
    
    // Set initial state - default to white
    if (selectWhite) {
        console.log('Setting initial state to white');
        selectWhite.classList.add('selected-side');
    }
    
    // Don't call changeSide immediately, wait for engine to be ready
    console.log('Waiting for engine to be ready...');
    const checkEngine = setInterval(() => {
        if (engineReady) {
            console.log('Engine is ready, initializing game...');
            clearInterval(checkEngine);
            changeSide('w');  // Initialize with white side selected
        }
    }, 100);
    
    // Set up undo button with red color
    const undoButton = document.getElementById('undoButton');
    if (undoButton) {
        console.log('Setting up undo button');
        undoButton.addEventListener('click', undoLastMove);
        undoButton.style.backgroundColor = '#f44336';
        undoButton.style.color = 'white';
        undoButton.style.borderColor = '#f44336';
        undoButton.style.border = '2px solid #f44336';
    } else {
        console.error('Undo button not found!');
    }
    
    console.log('Initial evaluation starting...');
    setTimeout(() => {
        evaluatePosition(function(rawScore) {
            console.log('Initial evaluation complete:', rawScore);
            displayScore(rawScore, rawScore, 0);
            playerLastScore = rawScore;
        });
    }, 2000);
};
