import React, { useState, useCallback, useRef } from 'react';
import Image from 'next/image';

type Props = {
  onSearch: (term: string) => void;
};

export default function SearchBar({ onSearch }: Props) {
  const [term, setTerm] = useState('');
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const throttledSearch = useCallback(
    (value: string) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = setTimeout(() => {
        onSearch(value);
      }, 300);
    },
    [onSearch]
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setTerm(value);
    throttledSearch(value);
  };

  const handleClear = () => {
    setTerm('');
    onSearch('');
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  };

  return (
    <div className="relative w-full">
      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
        <Image src="/search.svg" alt="search" width={24} height={24} />
      </div>
      <input
        type="text"
        className="w-full text-[16px] md:text-lg text-[#23262f] border border-[#d0d5dd] rounded-[10px] h-[56px] mb-0 pl-12 pr-10 py-4 text-lg leading-[1.55em] transition-colors duration-400 ease-in-out shadow-[1px_0_2px_rgba(16,24,40,0.05)] focus:outline-none focus:border-[#2563eb]"
        placeholder="Search by name, chain ID, or description"
        value={term}
        onChange={handleChange}
      />
      {term && (
        <button
          onClick={handleClear}
          className="absolute inset-y-0 right-0 pr-4 flex items-center text-[#b1b5c3] hover:text-[#23262f] transition-colors"
          aria-label="Clear search"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
          </svg>
        </button>
      )}
    </div>
  );
}
