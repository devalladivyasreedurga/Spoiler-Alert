import React, { useState } from 'react';
import './App.css';

function App() {
  const [input, setInput] = useState('');
  const [expiryInfo, setExpiryInfo] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [source, setSource] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setExpiryInfo('');
    setImageUrl('');
    setSource('');
    setLoading(true);

    try {
      const response = await fetch('/api/get-expiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productName: input })
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch data');
      }
      
      const data = await response.json();
      setExpiryInfo(data.expiryInfo);
      setImageUrl(data.imageUrl);
      setSource(data.source);
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
          placeholder="Enter food product name"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          required
        />
        <button type="submit" disabled={loading}>
          {loading ? 'Loading...' : 'Check Expiry'}
        </button>
      </form>
      
      {error && <p className="error">{error}</p>}
      
      {expiryInfo && (
        <div className="result">
          <h2>{input}</h2>
          <p>Expires in: {expiryInfo} days</p>
          {imageUrl && (
            <img 
              src={imageUrl} 
              alt={`${input} illustration`} 
              style={{ maxWidth: '400px', marginTop: '20px' }} 
            />
          )}
          <p>Data source: {source}</p>
        </div>
      )}
    </div>
  );
}

export default App;
