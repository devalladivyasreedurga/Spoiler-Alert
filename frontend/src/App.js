// frontend/src/App.js
import React, { useState } from 'react';
import './App.css';

function App() {
  const [item, setItem] = useState('');
  const [expiry, setExpiry] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setExpiry(null);
    
    try {
      const response = await fetch('/api/get-expiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productName: item })
      });
      
      if (!response.ok) {
        throw new Error('Error fetching expiry information');
      }
      
      const data = await response.json();
      setExpiry(data.expiryInfo);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  return (
    <div className="App">
      <h1>Grocery Expiry Tracker</h1>
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder="Enter grocery item name"
          value={item}
          onChange={(e) => setItem(e.target.value)}
          required
        />
        <button type="submit" disabled={loading}>
          {loading ? 'Loading...' : 'Get Expiry Time'}
        </button>
      </form>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {expiry && (
        <div>
          <h2>Expiry Information:</h2>
          <p>{expiry} days</p>
        </div>
      )}
    </div>
  );
}

export default App;
