-- Défi du jour (section 7) : une tentative comptée par joueur et par jour (UTC).
CREATE TABLE daily_results (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  match_id UUID NOT NULL,
  won BOOLEAN NOT NULL,
  turns INT NOT NULL,
  lives_left INT NOT NULL,
  lives_taken INT NOT NULL,
  score INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, date)
);
CREATE INDEX daily_results_board ON daily_results(date, score DESC, created_at);
