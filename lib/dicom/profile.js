/**
 * DICOM header de-identification profile.
 *
 * Based on DICOM PS3.15 Annex E, Basic Application Level Confidentiality
 * Profile, with the "Retain Longitudinal Temporal Information with Modified
 * Dates" and "Retain Patient Characteristics" options, plus rule-based
 * cleaning of the few descriptive text attributes that are kept because CT
 * research needs them (study/series description, protocol name).
 *
 * Decisions specific to this project:
 * - Names and identifiers are removed or emptied, never pseudonymized.
 * - Patient ID becomes a cuid-style code keyed by a per-run random secret
 *   that is never stored: studies of the same patient stay grouped within a
 *   batch, and nobody (including the operator) can map the code back.
 * - UIDs are remapped to 2.25.<decimal> derived from the output root's vault
 *   salt, so references between files and re-runs stay consistent.
 * - Pixel data is never touched.
 */
import { createHmac } from 'node:crypto'
import { scan } from '../rules.js'
import { charsetDecoder, decodeAscii, stringValue } from './codec.js'

// [tag, VR, action, name]. Actions: X remove, Z empty (keep the element),
// D patient ID code, K keep (text is rule-scanned), BIRTH, AGE, SEX.
const TABLE = [
  // Meta group
  ['00020016', 'AE', 'X', 'SourceApplicationEntityTitle'],
  ['00020017', 'AE', 'X', 'SendingApplicationEntityTitle'],
  ['00020018', 'AE', 'X', 'ReceivingApplicationEntityTitle'],
  ['00020100', 'UI', 'X', 'PrivateInformationCreatorUID'],
  ['00020102', 'OB', 'X', 'PrivateInformation'],
  // General study / series / equipment
  ['00080050', 'SH', 'Z', 'AccessionNumber'],
  ['00080051', 'SQ', 'X', 'IssuerOfAccessionNumberSequence'],
  ['00080080', 'LO', 'X', 'InstitutionName'],
  ['00080081', 'ST', 'X', 'InstitutionAddress'],
  ['00080082', 'SQ', 'X', 'InstitutionCodeSequence'],
  ['00080090', 'PN', 'Z', 'ReferringPhysicianName'],
  ['00080092', 'ST', 'X', 'ReferringPhysicianAddress'],
  ['00080094', 'SH', 'X', 'ReferringPhysicianTelephoneNumbers'],
  ['00080096', 'SQ', 'X', 'ReferringPhysicianIdentificationSequence'],
  ['00080201', 'SH', 'X', 'TimezoneOffsetFromUTC'],
  ['00081010', 'SH', 'X', 'StationName'],
  ['00081030', 'LO', 'K', 'StudyDescription'],
  ['0008103E', 'LO', 'K', 'SeriesDescription'],
  ['00081040', 'LO', 'X', 'InstitutionalDepartmentName'],
  ['00081041', 'SQ', 'X', 'InstitutionalDepartmentTypeCodeSequence'],
  ['00081048', 'PN', 'X', 'PhysiciansOfRecord'],
  ['00081049', 'SQ', 'X', 'PhysiciansOfRecordIdentificationSequence'],
  ['00081050', 'PN', 'X', 'PerformingPhysicianName'],
  ['00081052', 'SQ', 'X', 'PerformingPhysicianIdentificationSequence'],
  ['00081060', 'PN', 'X', 'NameOfPhysiciansReadingStudy'],
  ['00081062', 'SQ', 'X', 'PhysiciansReadingStudyIdentificationSequence'],
  ['00081070', 'PN', 'X', 'OperatorsName'],
  ['00081072', 'SQ', 'X', 'OperatorIdentificationSequence'],
  ['00081080', 'LO', 'X', 'AdmittingDiagnosesDescription'],
  ['00081084', 'SQ', 'X', 'AdmittingDiagnosesCodeSequence'],
  ['00081110', 'SQ', 'X', 'ReferencedStudySequence'],
  ['00081111', 'SQ', 'X', 'ReferencedPerformedProcedureStepSequence'],
  ['00081120', 'SQ', 'X', 'ReferencedPatientSequence'],
  ['00082111', 'ST', 'X', 'DerivationDescription'],
  ['00084000', 'LT', 'X', 'IdentifyingComments'],
  // Patient
  ['00100010', 'PN', 'Z', 'PatientName'],
  ['00100020', 'LO', 'D', 'PatientID'],
  ['00100021', 'LO', 'X', 'IssuerOfPatientID'],
  ['00100022', 'CS', 'X', 'TypeOfPatientID'],
  ['00100024', 'SQ', 'X', 'IssuerOfPatientIDQualifiersSequence'],
  ['00100030', 'DA', 'BIRTH', 'PatientBirthDate'],
  ['00100032', 'TM', 'X', 'PatientBirthTime'],
  ['00100033', 'LO', 'X', 'PatientBirthDateInAlternativeCalendar'],
  ['00100034', 'LO', 'X', 'PatientDeathDateInAlternativeCalendar'],
  ['00100035', 'CS', 'X', 'PatientAlternativeCalendar'],
  ['00100040', 'CS', 'SEX', 'PatientSex'],
  ['00100050', 'SQ', 'X', 'PatientInsurancePlanCodeSequence'],
  ['00100101', 'SQ', 'X', 'PatientPrimaryLanguageCodeSequence'],
  ['00100102', 'SQ', 'X', 'PatientPrimaryLanguageModifierCodeSequence'],
  ['00100200', 'CS', 'K', 'QualityControlSubject'],
  ['00100212', 'UC', 'X', 'StrainDescription'],
  ['00101000', 'LO', 'X', 'OtherPatientIDs'],
  ['00101001', 'PN', 'X', 'OtherPatientNames'],
  ['00101002', 'SQ', 'X', 'OtherPatientIDsSequence'],
  ['00101005', 'PN', 'X', 'PatientBirthName'],
  ['00101010', 'AS', 'AGE', 'PatientAge'],
  ['00101040', 'LO', 'X', 'PatientAddress'],
  ['00101050', 'LO', 'X', 'InsurancePlanIdentification'],
  ['00101060', 'PN', 'X', 'PatientMotherBirthName'],
  ['00101080', 'LO', 'X', 'MilitaryRank'],
  ['00101081', 'LO', 'X', 'BranchOfService'],
  ['00101090', 'LO', 'X', 'MedicalRecordLocator'],
  ['00101100', 'SQ', 'X', 'ReferencedPatientPhotoSequence'],
  ['00102000', 'LO', 'X', 'MedicalAlerts'],
  ['00102110', 'LO', 'X', 'Allergies'],
  ['00102150', 'LO', 'X', 'CountryOfResidence'],
  ['00102152', 'LO', 'X', 'RegionOfResidence'],
  ['00102154', 'SH', 'X', 'PatientTelephoneNumbers'],
  ['00102155', 'LT', 'X', 'PatientTelecomInformation'],
  ['00102160', 'SH', 'X', 'EthnicGroup'],
  ['00102180', 'SH', 'X', 'Occupation'],
  ['001021A0', 'CS', 'X', 'SmokingStatus'],
  ['001021B0', 'LT', 'X', 'AdditionalPatientHistory'],
  ['001021C0', 'US', 'X', 'PregnancyStatus'],
  ['001021D0', 'DA', 'X', 'LastMenstrualDate'],
  ['001021F0', 'LO', 'X', 'PatientReligiousPreference'],
  ['00102203', 'CS', 'X', 'PatientSexNeutered'],
  ['00102297', 'PN', 'X', 'ResponsiblePerson'],
  ['00102299', 'LO', 'X', 'ResponsibleOrganization'],
  ['00104000', 'LT', 'X', 'PatientComments'],
  // Clinical trial
  ['00120010', 'LO', 'X', 'ClinicalTrialSponsorName'],
  ['00120020', 'LO', 'X', 'ClinicalTrialProtocolID'],
  ['00120030', 'LO', 'X', 'ClinicalTrialSiteID'],
  ['00120031', 'LO', 'X', 'ClinicalTrialSiteName'],
  ['00120040', 'LO', 'X', 'ClinicalTrialSubjectID'],
  ['00120042', 'LO', 'X', 'ClinicalTrialSubjectReadingID'],
  ['00120050', 'LO', 'X', 'ClinicalTrialTimePointID'],
  ['00120051', 'ST', 'X', 'ClinicalTrialTimePointDescription'],
  ['00120060', 'LO', 'X', 'ClinicalTrialCoordinatingCenterName'],
  ['00120071', 'LO', 'X', 'ClinicalTrialSeriesID'],
  ['00120072', 'LO', 'X', 'ClinicalTrialSeriesDescription'],
  ['00120081', 'LO', 'X', 'ClinicalTrialProtocolEthicsCommitteeName'],
  ['00120082', 'LO', 'X', 'ClinicalTrialProtocolEthicsCommitteeApprovalNumber'],
  // Device / acquisition
  ['00181000', 'LO', 'X', 'DeviceSerialNumber'],
  ['00181004', 'LO', 'X', 'PlateID'],
  ['00181005', 'LO', 'X', 'GeneratorID'],
  ['00181007', 'LO', 'X', 'CassetteID'],
  ['00181008', 'LO', 'X', 'GantryID'],
  ['00181030', 'LO', 'K', 'ProtocolName'],
  ['00181400', 'LO', 'X', 'AcquisitionDeviceProcessingDescription'],
  ['00184000', 'LT', 'X', 'AcquisitionComments'],
  ['0018700A', 'SH', 'X', 'DetectorID'],
  ['00189424', 'LT', 'X', 'AcquisitionProtocolDescription'],
  ['0018A003', 'ST', 'X', 'ContributionDescription'],
  // Study / series / image
  ['00200010', 'SH', 'Z', 'StudyID'],
  ['00204000', 'LT', 'X', 'ImageComments'],
  ['00209158', 'LT', 'X', 'FrameComments'],
  ['00284000', 'LT', 'X', 'ImagePresentationComments'],
  // Study / visit / procedure management
  ['00320012', 'LO', 'X', 'StudyIDIssuer'],
  ['00321020', 'LO', 'X', 'ScheduledStudyLocation'],
  ['00321021', 'AE', 'X', 'ScheduledStudyLocationAETitle'],
  ['00321030', 'LO', 'X', 'ReasonForStudy'],
  ['00321032', 'PN', 'X', 'RequestingPhysician'],
  ['00321033', 'LO', 'X', 'RequestingService'],
  ['00321060', 'LO', 'X', 'RequestedProcedureDescription'],
  ['00321066', 'UT', 'X', 'ReasonForVisit'],
  ['00321067', 'SQ', 'X', 'ReasonForVisitCodeSequence'],
  ['00321070', 'LO', 'X', 'RequestedContrastAgent'],
  ['00324000', 'LT', 'X', 'StudyComments'],
  ['00380004', 'SQ', 'X', 'ReferencedPatientAliasSequence'],
  ['00380010', 'LO', 'X', 'AdmissionID'],
  ['00380011', 'LO', 'X', 'IssuerOfAdmissionID'],
  ['00380014', 'SQ', 'X', 'IssuerOfAdmissionIDSequence'],
  ['00380020', 'DA', 'X', 'AdmittingDate'],
  ['00380021', 'TM', 'X', 'AdmittingTime'],
  ['00380060', 'LO', 'X', 'ServiceEpisodeID'],
  ['00380061', 'LO', 'X', 'IssuerOfServiceEpisodeID'],
  ['00380062', 'LO', 'X', 'ServiceEpisodeDescription'],
  ['00380064', 'SQ', 'X', 'IssuerOfServiceEpisodeIDSequence'],
  ['00380300', 'LO', 'X', 'CurrentPatientLocation'],
  ['00380400', 'LO', 'X', 'PatientInstitutionResidence'],
  ['00380500', 'LO', 'X', 'PatientState'],
  ['00384000', 'LT', 'X', 'VisitComments'],
  ['00400001', 'AE', 'X', 'ScheduledStationAETitle'],
  ['00400002', 'DA', 'X', 'ScheduledProcedureStepStartDate'],
  ['00400003', 'TM', 'X', 'ScheduledProcedureStepStartTime'],
  ['00400004', 'DA', 'X', 'ScheduledProcedureStepEndDate'],
  ['00400005', 'TM', 'X', 'ScheduledProcedureStepEndTime'],
  ['00400006', 'PN', 'X', 'ScheduledPerformingPhysicianName'],
  ['00400007', 'LO', 'X', 'ScheduledProcedureStepDescription'],
  ['00400009', 'SH', 'X', 'ScheduledProcedureStepID'],
  ['0040000B', 'SQ', 'X', 'ScheduledPerformingPhysicianIdentificationSequence'],
  ['00400010', 'SH', 'X', 'ScheduledStationName'],
  ['00400011', 'SH', 'X', 'ScheduledProcedureStepLocation'],
  ['00400012', 'LO', 'X', 'PreMedication'],
  ['00400241', 'AE', 'X', 'PerformedStationAETitle'],
  ['00400242', 'SH', 'X', 'PerformedStationName'],
  ['00400243', 'SH', 'X', 'PerformedLocation'],
  ['00400253', 'SH', 'X', 'PerformedProcedureStepID'],
  ['00400254', 'LO', 'X', 'PerformedProcedureStepDescription'],
  ['00400275', 'SQ', 'X', 'RequestAttributesSequence'],
  ['00400280', 'ST', 'X', 'CommentsOnThePerformedProcedureStep'],
  ['00400555', 'SQ', 'X', 'AcquisitionContextSequence'],
  ['00401001', 'SH', 'X', 'RequestedProcedureID'],
  ['00401002', 'LO', 'X', 'ReasonForTheRequestedProcedure'],
  ['00401004', 'LO', 'X', 'PatientTransportArrangements'],
  ['00401005', 'LO', 'X', 'RequestedProcedureLocation'],
  ['00401010', 'PN', 'X', 'NamesOfIntendedRecipientsOfResults'],
  ['00401011', 'SQ', 'X', 'IntendedRecipientsOfResultsIdentificationSequence'],
  ['00401101', 'SQ', 'X', 'PersonIdentificationCodeSequence'],
  ['00401102', 'ST', 'X', 'PersonAddress'],
  ['00401103', 'LO', 'X', 'PersonTelephoneNumbers'],
  ['00401104', 'LT', 'X', 'PersonTelecomInformation'],
  ['00401400', 'LT', 'X', 'RequestedProcedureComments'],
  ['00402001', 'LO', 'X', 'ReasonForTheImagingServiceRequest'],
  ['00402008', 'PN', 'X', 'OrderEnteredBy'],
  ['00402009', 'SH', 'X', 'OrderEntererLocation'],
  ['00402010', 'SH', 'X', 'OrderCallbackPhoneNumber'],
  ['00402011', 'LT', 'X', 'OrderCallbackTelecomInformation'],
  ['00402016', 'LO', 'X', 'PlacerOrderNumberImagingServiceRequest'],
  ['00402017', 'LO', 'X', 'FillerOrderNumberImagingServiceRequest'],
  ['00402400', 'LT', 'X', 'ImagingServiceRequestComments'],
  ['00403001', 'LO', 'X', 'ConfidentialityConstraintOnPatientDataDescription'],
  ['0040A073', 'SQ', 'X', 'VerifyingObserverSequence'],
  ['0040A075', 'PN', 'X', 'VerifyingObserverName'],
  ['0040A078', 'SQ', 'X', 'AuthorObserverSequence'],
  ['0040A07A', 'SQ', 'X', 'ParticipantSequence'],
  ['0040A07C', 'SQ', 'X', 'CustodialOrganizationSequence'],
  ['0040A088', 'SQ', 'X', 'VerifyingObserverIdentificationCodeSequence'],
  ['0040A123', 'PN', 'X', 'PersonName'],
  ['0040A730', 'SQ', 'X', 'ContentSequence'],
  ['00700084', 'PN', 'X', 'ContentCreatorName'],
  ['00700086', 'SQ', 'X', 'ContentCreatorIdentificationCodeSequence'],
  ['00880130', 'SH', 'X', 'StorageMediaFileSetID'],
  ['00880200', 'SQ', 'X', 'IconImageSequence'],
  ['300E0008', 'PN', 'X', 'ReviewerName'],
  ['40000010', 'LT', 'X', 'Arbitrary'],
  ['40004000', 'LT', 'X', 'TextComments'],
  ['40080042', 'LO', 'X', 'ResultsIDIssuer'],
  ['40080102', 'PN', 'X', 'InterpretationRecorder'],
  ['4008010A', 'PN', 'X', 'InterpretationTranscriber'],
  ['4008010B', 'ST', 'X', 'InterpretationText'],
  ['4008010C', 'PN', 'X', 'InterpretationAuthor'],
  ['40080111', 'SQ', 'X', 'InterpretationApproverSequence'],
  ['40080114', 'PN', 'X', 'PhysicianApprovingInterpretation'],
  ['40080115', 'LT', 'X', 'InterpretationDiagnosisDescription'],
  ['40080118', 'SQ', 'X', 'ResultsDistributionListSequence'],
  ['40080119', 'PN', 'X', 'DistributionName'],
  ['4008011A', 'LO', 'X', 'DistributionAddress'],
  ['40080202', 'LO', 'X', 'InterpretationIDIssuer'],
  ['40080300', 'ST', 'X', 'Impressions'],
  ['40084000', 'ST', 'X', 'ResultsComments'],
  // Digital signatures and originals of modified attributes
  ['04000100', 'UI', 'X', 'DigitalSignatureUID'],
  ['04000402', 'SQ', 'X', 'ReferencedDigitalSignatureSequence'],
  ['04000403', 'SQ', 'X', 'ReferencedSOPInstanceMACSequence'],
  ['04000561', 'SQ', 'X', 'OriginalAttributesSequence'],
  ['FFFAFFFA', 'SQ', 'X', 'DigitalSignaturesSequence'],
  ['FFFCFFFC', 'OB', 'X', 'DataSetTrailingPadding'],
]

const BY_TAG = new Map(TABLE.map(([tag, vr, action, name]) => [tag, { vr, action, name }]))

// UIDs that name standard things (classes, syntaxes, coding schemes), not
// instances: never remapped.
const KEEP_UID_TAGS = new Set([
  '00020002', '00020010', '00020012', '00080016', '0008001A', '0008001B',
  '00080062', '0008010C', '00080117', '00080118', '00081150', '00041510', '00041512',
])

// VRs for the implicit-VR dictionary beyond the profile table.
const EXTRA_VR = {
  '00020001': 'OB', '00020002': 'UI', '00020003': 'UI', '00020010': 'UI', '00020012': 'UI', '00020013': 'SH',
  '00080005': 'CS', '00080008': 'CS', '00080012': 'DA', '00080013': 'TM', '00080014': 'UI', '00080016': 'UI',
  '00080018': 'UI', '00080020': 'DA', '00080021': 'DA', '00080022': 'DA', '00080023': 'DA', '00080024': 'DA',
  '00080025': 'DA', '0008002A': 'DT', '00080030': 'TM', '00080031': 'TM', '00080032': 'TM', '00080033': 'TM',
  '00080060': 'CS', '00080062': 'UI', '00080070': 'LO', '00080100': 'SH', '00080102': 'SH', '00080104': 'LO',
  '0008010C': 'UI', '00080117': 'UI', '00081032': 'SQ', '00081090': 'LO', '00081115': 'SQ', '00081140': 'SQ',
  '00081150': 'UI', '00081155': 'UI', '00081195': 'UI', '00081199': 'SQ', '00082112': 'SQ', '00082218': 'SQ',
  '00083010': 'UI', '00089215': 'SQ', '00101020': 'DS', '00101030': 'DS', '00120062': 'CS', '00120063': 'LO',
  '00120064': 'SQ', '00180015': 'CS', '00181002': 'UI', '00181012': 'DA', '00181020': 'LO', '00181200': 'DA',
  '00181201': 'TM', '00189321': 'SQ', '00189346': 'SQ', '0020000D': 'UI', '0020000E': 'UI', '00200052': 'UI',
  '00200200': 'UI', '00200242': 'UI', '00209161': 'UI', '00209164': 'UI', '00280301': 'CS', '00280302': 'CS',
  '00280303': 'CS', '00281199': 'UI', '00320032': 'DA', '00320034': 'DA', '00400244': 'DA', '00400245': 'TM',
  '00400250': 'DA', '00400251': 'TM', '00400260': 'SQ', '0040A120': 'DT', '0040A121': 'DA', '0040A124': 'UI',
  '00700082': 'DA', '00880140': 'UI', '30060008': 'DA', '30060024': 'UI', '300600C2': 'UI', '300A0006': 'DA',
}

export function dictVr(tag) {
  return BY_TAG.get(tag)?.vr ?? EXTRA_VR[tag] ?? null
}

const TEXT_VR = new Set(['SH', 'LO', 'ST', 'LT', 'UT', 'UC'])
const UID_LIKE = /^\d+(?:\.\d+){3,}$/
const DATE_LIKE = /^(?:19|20)\d{6}$/

/* ------------------------------------------------------------- generators */

/** 2.25.<decimal>: a UUID-derived UID (PS3.5 B.2), stable for one salt. */
export function remapUid(uid, salt) {
  const hex = createHmac('sha256', String(salt)).update(`uid\u0000${uid}`).digest('hex').slice(0, 32)
  return `2.25.${BigInt(`0x${hex}`).toString(10)}`
}

const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz'

/**
 * cuid-style patient code: "c" + 24 base36 chars. Keyed by a secret that only
 * exists in memory for one run, so it cannot be reversed or recomputed later.
 */
export function patientCode(patientId, runKey) {
  const digest = createHmac('sha256', runKey).update(`pid\u0000${String(patientId).trim()}`).digest()
  let value = BigInt(`0x${digest.toString('hex')}`)
  let out = ''
  while (out.length < 24) {
    out += BASE36[Number(value % 36n)]
    value /= 36n
  }
  return `c${out}`
}

/* -------------------------------------------------------------- date/age */

function validDate(y, m, d) {
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

function transformDate8(text, mode, shiftDays) {
  const match = /^(\d{4})\.?(\d{2})\.?(\d{2})$/.exec(text)
  if (!match) return null
  const y = Number(match[1])
  const m = Number(match[2])
  const d = Number(match[3])
  if (!validDate(y, m, d)) return null
  let date = new Date(Date.UTC(y, m - 1, d))
  if (mode === 'shift') date = new Date(date.getTime() + shiftDays * 86400000)
  else if (mode === 'month') date = new Date(Date.UTC(y, m - 1, 1))
  else if (mode === 'year') date = new Date(Date.UTC(y, 0, 1))
  const yy = String(date.getUTCFullYear()).padStart(4, '0')
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(date.getUTCDate()).padStart(2, '0')
  return `${yy}${mm}${dd}`
}

/** @returns {string|null} new value, or null when it cannot be parsed */
function transformDateValue(text, vr, mode, shiftDays) {
  const values = text.split('\\')
  const out = []
  for (const raw of values) {
    const value = raw.trim()
    if (!value) { out.push(''); continue }
    if (vr === 'DA') {
      const parts = value.split('-') // ranges only appear in queries, but be safe
      const mapped = parts.map((part) => (part ? transformDate8(part, mode, shiftDays) : ''))
      if (mapped.some((part, i) => parts[i] && part === null)) return null
      out.push(mapped.join('-'))
    } else {
      // DT: YYYYMMDD[HHMMSS[.FFFFFF]][&ZZXX]. Drop the UTC offset (the
      // timezone attribute itself is removed).
      const match = /^(\d{8})(\d{0,6}(?:\.\d{1,6})?)?(?:[+-]\d{4})?$/.exec(value)
      if (!match) return null
      const date = transformDate8(match[1], mode, shiftDays)
      if (date === null) return null
      const time = mode === 'shift' || mode === 'keep' ? (match[2] ?? '') : ''
      out.push(`${date}${time}`)
    }
  }
  return out.join('\\')
}

function transformAge(text, mode) {
  const match = /^(\d{3})([DWMY])$/.exec(text.trim())
  if (!match) return null
  const n = Number(match[1])
  if (match[2] !== 'Y') return text.trim() // infants: days/weeks/months are kept
  if (n >= 90) return '090Y'
  if (mode === 'band10' || mode === 'band5') {
    const width = mode === 'band10' ? 10 : 5
    return `${String(Math.floor(n / width) * width).padStart(3, '0')}Y`
  }
  return text.trim()
}

/* ---------------------------------------------------------------- policy */

/**
 * DICOM settings derived from the shared policy. When quasi-identifier
 * handling is off, DICOM still shifts dates (Annex E would otherwise remove
 * them) and keeps age/sex, which CT research needs.
 */
export function dicomPolicy(policy) {
  const quasi = policy?.quasiEnabled ? policy.quasi ?? {} : {}
  return {
    dates: quasi['日期'] ?? 'shift',
    age: quasi['年龄'] ?? 'keep',
    sex: quasi['性别'] ?? 'keep',
  }
}

/* ----------------------------------------------------------------- apply */

function newStats() {
  return {
    removed: 0, emptied: 0, privateRemoved: 0, uidsRemapped: 0, datesChanged: 0,
    patientIds: 0, textRemoved: 0, ageChanged: 0,
  }
}

/**
 * De-identify a parsed file in memory.
 *
 * @param {object} parsed result of readDicom()
 * @param {{ salt: string, runKey: Buffer, shiftDays: number, policy: object }} options
 * @returns {{ meta, dataset, tail, stats, issues, originals }}
 */
export function deidentify(parsed, options) {
  const settings = dicomPolicy(options.policy)
  const stats = newStats()
  const issues = []
  const originals = { uids: new Set(), texts: new Set() }
  const charsetEl = parsed.dataset.find((el) => el.tag === '00080005')
  const charset = charsetDecoder(charsetEl ? decodeAscii(charsetEl.value) : '')
  if (!charset.known) {
    issues.push({ severity: 'warn', code: 'dicom-charset', detail: `字符集 ${decodeAscii(charsetEl.value)} 未识别，文字按 Latin-1 读取，扫描可能不完整` })
  }
  const ctx = { ...options, settings, stats, issues, originals, charset }

  const meta = processElements(parsed.meta, ctx, true)
  const dataset = processElements(parsed.dataset, ctx, false)
  const tail = processElements(parsed.tail ?? [], ctx, false)
  addMarkers(dataset, settings, parsed.explicit)
  return { meta, dataset, tail, stats, issues, originals }
}

function processElements(elements, ctx, isMeta) {
  const out = []
  for (const el of elements) {
    const next = processElement(el, ctx, isMeta)
    if (next) out.push(next)
  }
  return out
}

function textOf(el, ctx) {
  if (!el.value || el.value.length === 0) return ''
  return ctx.charset.decode(el.value).replace(/[\0 ]+$/, '').trim()
}

// Identity-bearing attributes whose original values feed the leak check.
// Generic removed text (device names, protocol words, coding schemes) is not
// included: it legitimately reappears in kept attributes.
const IDENTITY_TAGS = new Set([
  '00100010', '00100020', '00100021', '00100030', '00101000', '00101001', '00101005',
  '00101040', '00101060', '00101090', '00102154', '00102155', '00080050', '00200010',
  '00380010', '00380060', '00401001', '00402016', '00402017', '00080080', '00080081',
  '00080090', '00080092', '00080094', '00081048', '00081050', '00081060', '00321032',
])

/** Collect the original text of a removed/emptied identity element for the leak check. */
function remember(el, ctx) {
  if (!IDENTITY_TAGS.has(el.tag)) return
  if (!el.value || el.value.length === 0 || el.value.length > 4096) return
  if (!['PN', 'LO', 'SH', 'ST', 'LT', 'UT', 'UC', 'DA', 'DT', 'AE', 'UN'].includes(el.vr)) return
  const text = textOf(el, ctx)
  for (const part of text.split(/[\\^=]/)) {
    const token = part.trim()
    if (isDistinctive(token)) ctx.originals.texts.add(token)
  }
  if (isDistinctive(text)) ctx.originals.texts.add(text)
}

/** Long enough that finding it again is evidence, not coincidence. */
function isDistinctive(token) {
  if (!token) return false
  if (/[\u3400-\u9fff]/.test(token)) return token.replace(/[^\u3400-\u9fff]/g, '').length >= 2
  if (/^\d+$/.test(token)) return token.length >= 5
  return token.length >= 4
}

function rememberTree(el, ctx) {
  remember(el, ctx)
  for (const item of el.items ?? []) for (const child of item.elements) rememberTree(child, ctx)
}

function removed(el, ctx) {
  rememberTree(el, ctx)
  ctx.stats.removed += 1
  return null
}

function processElement(el, ctx, isMeta) {
  const { stats } = ctx
  const rule = BY_TAG.get(el.tag)
  const vr = el.vr

  if (el.element === 0x0000 && el.group !== 0x0002) { stats.removed += 1; return null } // group length
  if (el.group % 2 === 1) {
    rememberTree(el, ctx)
    stats.privateRemoved += 1
    return null
  }
  if (el.group >= 0x5000 && el.group <= 0x50FF) return removed(el, ctx) // curves
  if (el.group >= 0x6000 && el.group <= 0x60FF && (el.element === 0x4000 || el.element === 0x0022)) {
    return removed(el, ctx) // overlay comments/description
  }

  if (rule) {
    switch (rule.action) {
      case 'X':
        return removed(el, ctx)
      case 'Z':
        if (el.items) rememberTree(el, ctx)
        else remember(el, ctx)
        if ((el.value?.length ?? 0) > 0 || (el.items?.length ?? 0) > 0) stats.emptied += 1
        return { ...el, value: Buffer.alloc(0), items: el.items ? [] : undefined, raw: undefined }
      case 'BIRTH':
        remember(el, ctx)
        if ((el.value?.length ?? 0) > 0) stats.emptied += 1
        return { ...el, value: Buffer.alloc(0) }
      case 'D': {
        const original = textOf(el, ctx)
        if (!original) return el
        remember(el, ctx)
        stats.patientIds += 1
        return stringValue(el, patientCode(original, ctx.runKey))
      }
      case 'SEX':
        if (ctx.settings.sex === 'keep') return el
        if ((el.value?.length ?? 0) > 0) stats.emptied += 1
        return { ...el, value: Buffer.alloc(0) }
      case 'AGE': {
        const text = textOf(el, ctx)
        if (!text) return el
        if (ctx.settings.age === 'redact') return removed(el, ctx)
        const next = transformAge(text, ctx.settings.age)
        if (next === null) {
          ctx.issues.push({ severity: 'warn', code: 'dicom-age', detail: '年龄 (0010,1010) 格式无法识别，已删除' })
          return removed(el, ctx)
        }
        if (next !== text) stats.ageChanged += 1
        return stringValue(el, next)
      }
      default:
        break // 'K': fall through to generic handling (text scan)
    }
  }

  if (vr === 'PN') return removed(el, ctx)
  if (vr === 'AE' || vr === 'UR') return removed(el, ctx)

  if (el.items) {
    return {
      ...el,
      items: el.items.map((item) => ({ ...item, elements: processElements(item.elements, ctx, isMeta) })),
    }
  }

  if (vr === 'UI') return remapUidElement(el, ctx)
  if (vr === 'DA' || vr === 'DT') return transformDateElement(el, ctx)

  if (vr === 'UN' || el.implicitUnknown) return processUnknown(el, ctx)
  if (TEXT_VR.has(vr)) return scanText(el, ctx, rule?.name)
  return el
}

function remapUidElement(el, ctx) {
  const text = decodeAscii(el.value)
  if (!text || KEEP_UID_TAGS.has(el.tag)) return el
  let changed = false
  const mapped = text.split('\\').map((raw) => {
    const uid = raw.trim().replace(/\0+$/, '')
    if (!uid || uid.startsWith('1.2.840.10008.')) return uid
    ctx.originals.uids.add(uid)
    changed = true
    return remapUid(uid, ctx.salt)
  })
  if (!changed) return el
  ctx.stats.uidsRemapped += 1
  return stringValue(el, mapped.join('\\'))
}

function transformDateElement(el, ctx) {
  const text = decodeAscii(el.value)
  if (!text) return el
  const mode = ctx.settings.dates
  if (mode === 'keep') return el
  // Ordinary dates are not added to the leak check: a shifted date can
  // legitimately coincide with another original date.
  if (mode === 'redact') {
    ctx.stats.emptied += 1
    return { ...el, value: Buffer.alloc(0) }
  }
  const next = transformDateValue(text, el.vr, mode, ctx.shiftDays)
  if (next === null) {
    ctx.issues.push({ severity: 'warn', code: 'dicom-date', detail: `日期字段 (${formatTag(el.tag)}) 格式无法识别，已清空` })
    ctx.stats.emptied += 1
    return { ...el, value: Buffer.alloc(0) }
  }
  if (next !== text) ctx.stats.datesChanged += 1
  return stringValue(el, next)
}

/** Implicit-VR elements missing from the dictionary, and explicit UN. */
function processUnknown(el, ctx) {
  const value = el.value ?? Buffer.alloc(0)
  if (value.length === 0 || value.length > 65536) return el
  if (!isPrintable(value)) return el
  const text = decodeAscii(value)
  if (UID_LIKE.test(text) || text.split('\\').every((part) => UID_LIKE.test(part.trim()))) {
    return remapUidElement({ ...el, vr: el.implicitUnknown ? el.vr : 'UI' }, ctx)
  }
  if (DATE_LIKE.test(text) && transformDate8(text, 'keep', 0) !== null) {
    return transformDateElement({ ...el, vr: 'DA' }, ctx)
  }
  return scanText(el, ctx, null)
}

function isPrintable(buf) {
  for (const byte of buf) {
    if (byte === 0 || byte === 0x09 || byte === 0x0A || byte === 0x0D || byte === 0x1B) continue
    if (byte < 0x20 || byte === 0x7F) return false
  }
  return true
}

/** Kept text: remove the whole element when the identifier rules hit. */
function scanText(el, ctx, name) {
  const text = textOf(el, ctx)
  if (!text) return el
  const hits = scan(text)
  if (hits.length === 0) return el
  ctx.stats.textRemoved += 1
  ctx.issues.push({
    severity: 'warn',
    code: 'dicom-text',
    detail: `字段 (${formatTag(el.tag)})${name ? ` ${name}` : ''} 含疑似${[...new Set(hits.map((hit) => hit.type))].join('、')}，已整体删除`,
  })
  return removed(el, ctx)
}

export function formatTag(tag) {
  return `${tag.slice(0, 4)},${tag.slice(4)}`
}

/* --------------------------------------------------------------- markers */

function codeItem(value, meaning) {
  return {
    undef: false,
    elements: [
      textElement('00080100', 'SH', value),
      textElement('00080102', 'SH', 'DCM'),
      textElement('00080104', 'LO', meaning),
    ],
  }
}

function textElement(tag, vr, text) {
  return {
    tag,
    group: parseInt(tag.slice(0, 4), 16),
    element: parseInt(tag.slice(4), 16),
    vr,
    value: Buffer.from(text, 'latin1'),
  }
}

function addMarkers(dataset, settings, explicit) {
  const codes = [codeItem('113100', 'Basic Application Confidentiality Profile')]
  if (settings.dates === 'shift') codes.push(codeItem('113107', 'Retain Longitudinal With Modified Dates Option'))
  if (settings.age === 'keep' && settings.sex === 'keep') codes.push(codeItem('113108', 'Retain Patient Characteristics Option'))
  const temporal = settings.dates === 'keep' ? 'UNMODIFIED' : settings.dates === 'redact' ? 'REMOVED' : 'MODIFIED'
  const markers = [
    textElement('00120062', 'CS', 'YES'),
    textElement('00120063', 'LO', 'dsh-medical-anonymizer PS3.15 E.1'),
    {
      tag: '00120064', group: 0x0012, element: 0x0064, vr: 'SQ', childExplicit: explicit, undef: false, items: codes,
    },
    textElement('00280303', 'CS', temporal),
  ]
  for (const marker of markers) {
    const index = dataset.findIndex((el) => el.tag === marker.tag)
    if (index >= 0) dataset.splice(index, 1, marker)
    else dataset.push(marker)
  }
  dataset.sort((a, b) => (a.group - b.group) || (a.element - b.element))
}

/* ---------------------------------------------------------- verification */

/** CJK tokens match as substrings; Latin tokens only as whole words. */
function containsToken(text, token) {
  if (/[\u3400-\u9fff]/.test(token)) return text.includes(token)
  let from = 0
  for (;;) {
    const index = text.indexOf(token, from)
    if (index < 0) return false
    const before = index > 0 ? text[index - 1] : ''
    const after = text[index + token.length] ?? ''
    if (!/[A-Za-z0-9]/.test(before) && !/[A-Za-z0-9]/.test(after)) return true
    from = index + 1
  }
}

/**
 * Check a de-identified header for anything that should not be there.
 * @returns {{ name: string, ok: boolean, detail: string }[]}
 */
export function verifyHeader(parsed, originals, charset) {
  const problems = { pn: 0, private: 0, uid: 0, text: 0 }
  const leaked = new Set()
  const walk = (elements) => {
    for (const el of elements) {
      if (el.group % 2 === 1) problems.private += 1
      if (el.vr === 'PN' && el.value && decodeAscii(el.value)) problems.pn += 1
      if (el.items) {
        for (const item of el.items) walk(item.elements)
        continue
      }
      if (!el.value || el.value.length === 0 || el.value.length > 65536) continue
      if ((el.vr === 'UI' || el.implicitUnknown || el.vr === 'UN') && !KEEP_UID_TAGS.has(el.tag)) {
        for (const part of decodeAscii(el.value).split('\\')) {
          if (originals.uids.has(part.trim())) problems.uid += 1
        }
      }
      if (['OB', 'OW', 'OF', 'OD', 'OL', 'OV', 'FL', 'FD', 'SL', 'SS', 'UL', 'US', 'SV', 'UV', 'AT'].includes(el.vr)) continue
      if ((el.vr === 'UN' || el.implicitUnknown) && !isPrintable(el.value)) continue
      const text = charset.decode(el.value)
      for (const token of originals.texts) {
        if (containsToken(text, token)) {
          problems.text += 1
          leaked.add(token)
        }
      }
    }
  }
  walk(parsed.meta)
  walk(parsed.dataset)
  const checks = [
    { name: '姓名字段', ok: problems.pn === 0, detail: problems.pn === 0 ? '无残留' : `${problems.pn} 个 PN 字段仍有值` },
    { name: '私有字段', ok: problems.private === 0, detail: problems.private === 0 ? '已全部删除' : `残留 ${problems.private} 个` },
    { name: 'UID', ok: problems.uid === 0, detail: problems.uid === 0 ? '无原始 UID' : `残留 ${problems.uid} 个原始 UID` },
    { name: '原值复扫', ok: problems.text === 0, detail: problems.text === 0 ? '未发现被删除的原值' : `发现 ${leaked.size} 个被删除的原值再次出现` },
  ]
  return checks
}
