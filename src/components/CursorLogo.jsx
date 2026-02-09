import React from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { prefixUrl } from '../utils/api';

const CursorLogo = ({ className = 'w-5 h-5' }) => {
  const { isDarkMode } = useTheme();

  return (
    <img
      src={prefixUrl(isDarkMode ? "/icons/cursor-white.svg" : "/icons/cursor.svg")}
      alt="Cursor"
      className={className}
    />
  );
};

export default CursorLogo;
