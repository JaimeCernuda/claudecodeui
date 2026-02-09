import React from 'react';
import { prefixUrl } from '../utils/api';

const ClaudeLogo = ({className = 'w-5 h-5'}) => {
  return (
    <img src={prefixUrl("/icons/claude-ai-icon.svg")} alt="Claude" className={className} />
  );
};

export default ClaudeLogo;


