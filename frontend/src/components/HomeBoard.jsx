import React from 'react';
import { SENTENCES } from './HomeSpecimen';

// The landing page's board: a canvas the way a board looks, with a
// booklet, a collection and loose cards of several kinds, and the
// sentences the visitor painted on the specimen above, each able to lead
// back to its place on the page.

function Kind({ children }) {
  return <span className="board-mock-kind">{children}</span>;
}

export default function HomeBoard({ painted, onBack }) {
  return (
    <div className="board-mock" aria-label="A board">
      <div className="board-mock-bar">
        <span className="board-mock-name">Origami</span>
        <span className="board-mock-count">{7 + painted.length} cards</span>
      </div>
      <div className="board-mock-canvas">
        <div className="board-mock-booklet">
          <p className="board-mock-group-title">Demaine, 6.849</p>
          <div className="board-mock-card">
            <Kind>File</Kind>
            <p className="board-mock-file">Geometric Folding Algorithms.pdf</p>
          </div>
          <div className="board-mock-card">
            <Kind>Image</Kind>
            <div className="board-mock-image chalk" aria-hidden="true" />
            <p>Crimp and end fold, from lecture 4</p>
          </div>
        </div>

        <div className="board-mock-loose">
          {painted.map((id) => (
            <div key={id} className="board-mock-card excerpt">
              <Kind>Excerpt</Kind>
              <p>{SENTENCES[id]}</p>
              <button type="button" className="specimen-backlink" onClick={() => onBack(id)}>
                ↖ Folding as Computation, p. 1
              </button>
            </div>
          ))}
          {!painted.length && (
            <div className="board-mock-card placeholder">
              <p>Paint a sentence on the page above. It lands here, and still knows where it came from.</p>
            </div>
          )}
          <div className="board-mock-card thought">
            <Kind>Thought</Kind>
            <p>Could a crease be a register?</p>
          </div>
          <div className="board-mock-card">
            <Kind>YouTube video</Kind>
            <div className="board-mock-image video" aria-hidden="true"><span>▶</span></div>
            <p>Pop-up cards, by Peter Dahmen</p>
          </div>
        </div>

        <div className="board-mock-collection">
          <p className="board-mock-group-title">People</p>
          <div className="board-mock-card">
            <Kind>Webpage</Kind>
            <div className="board-mock-image page" aria-hidden="true" />
            <p>Origami Simulator</p>
          </div>
          <div className="board-mock-card">
            <Kind>Webpage</Kind>
            <div className="board-mock-image lab" aria-hidden="true" />
            <p>A soft-robotics lab</p>
          </div>
        </div>
      </div>
    </div>
  );
}
