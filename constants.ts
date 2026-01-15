import { Playbook } from './types';

export const MOCK_INITIAL_DOC = `Legal 500 Submissions

If you would like to understand how your firm or practice can improve your submissions and encourage further client feedback, you can now commission the Legal 500 research team to support you.

FIRM NAME:
[Insert Firm Name]

COUNTRY:
[Insert Country]

PRACTICE AREA:
[Select practice area]

---------------------------------------------------------
A. PRELIMINARY INFORMATION

1. Department name (as used by your firm):
[Insert Department Name]

2. Head(s) of Team:
Name: [Insert Name]
Email: [Insert Email]

3. Number of partners in the team:
[Insert Number]

4. Number of associates in the team:
[Insert Number]

---------------------------------------------------------
B. DEPARTMENT INFORMATION

5. What is the team or department known for?
[Insert description of practice strengths, key capabilities, and market position...]

6. Work Highlights (Publishable matters):
Please provide up to 20 highlight matters that represent the practice over the past 12 months.

Matter 1:
- Client: [Insert Client]
- Value: [Insert Value]
- Summary: [Insert Summary]

Matter 2:
- Client: [Insert Client]
- Value: [Insert Value]
- Summary: [Insert Summary]
`;

export const PLAYBOOKS: Playbook[] = [
  {
    id: 'notary-compliance',
    name: 'Notary Compliance Check',
    description: 'Ensures the document meets standard notarization requirements including venue, jurat, and identity verification language.',
    rules: [
      'Must include the Venue (State and County) at the top.',
      'Must include a Jurat or Acknowledgment statement.',
      'Affiant name in the body must match the signature line.',
      'Date of signature must match the notary date.',
      'Must include a placeholder for Notary Commission Expiration.',
    ],
  },
  {
    id: 'real-estate-closing',
    name: 'Real Estate Closing',
    description: 'Checks for required clauses in property transfer documents.',
    rules: [
      'Property address must be clearly defined.',
      'Grantor and Grantee names must be consistent throughout.',
      'Consideration amount (price) must be stated.',
      'Legal description of the property must be attached or included.',
    ],
  },
];

export const MOCK_REFERENCE_DOCS = [
  {
    id: 'chambers-submission',
    name: 'Fill in - Chambers submission form.docx',
    date: '8/11/2025',
    type: 'docx',
    content: `
      CHAMBERS SUBMISSION FORM
      
      Firm: Nora Legal LLP
      Country: United Kingdom
      Practice Area: Corporate/M&A
      
      Department: Corporate Finance
      Heads of Team: 
      - Sarah Williams (sarah.williams@noralegal.com)
      - Jonathan Mitchell (jonathan.mitchell@noralegal.com)
      
      Team Size: 
      Partners: 8
      Associates: 22
      
      Department Overview:
      Nora Legal is renowned for handling complex cross-border M&A transactions, particularly in the technology and renewable energy sectors. The team is praised for "commercial awareness" and "rapid execution."
      
      Work Highlights:
      1. Represented TechGiant Inc in the $2B acquisition of CloudStart Ltd. This was a cross-border deal involving UK, US, and German assets.
      2. Advised GreenEnergy Co on the disposal of its wind farm portfolio to InfraFund for £450M.
    `
  },
  {
    id: 'cust-agreement-phi',
    name: '4.2.21_Customer_Agreement_PhiVenture.pdf',
    date: '6/13/2025',
    type: 'pdf',
    content: `
      CUSTOMER AGREEMENT
      Party A: PhiVenture Holdings
      Party B: Nora Legal Services
      Term: 3 Years
    `
  },
  {
    id: 'annual-report',
    name: 'Annual_Report_2024_Final.pdf',
    date: '3/01/2025',
    type: 'pdf',
    content: `
      Financial Summary 2024:
      Revenue: $10M
      Growth: 15% YoY
    `
  }
];