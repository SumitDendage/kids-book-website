import { createContext, useContext } from 'react';

/* what every dashboard section may use: which panel, the signed-in staff member and what they
   may do, go to a section, refresh the badges, the product being edited, the customer card that
   is open (see Dashboard.jsx for the full list) */
export const DashContext = createContext(null);
export const useDash = () => useContext(DashContext);
