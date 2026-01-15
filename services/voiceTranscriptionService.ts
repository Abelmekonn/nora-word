/**
 * Voice Transcription Service
 * Integrates with Supabase Edge Function for voice-to-text transcription
 *
 * Uses the `voice-transcription` Edge function which:
 * - Accepts audio files via FormData
 * - Transcribes using OpenAI Whisper
 * - Enhances the transcription to create clean search queries
 */

import { supabase } from "./supabaseClient";

// Supabase project configuration
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const VOICE_TRANSCRIPTION_URL = `${SUPABASE_URL}/functions/v1/voice-transcription`;

/**
 * Response from the voice-transcription Edge function
 */
export interface VoiceTranscriptionResponse {
  transcription: string;
  enhanced_query: string;
  error?: string;
  details?: string;
}

/**
 * Recording state for the voice recorder
 */
export type RecordingState = "idle" | "recording" | "paused" | "processing";

/**
 * Get the current session's access token for Edge function authentication
 */
async function getAccessToken(): Promise<string> {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (error || !session) {
    throw new Error(
      "User not authenticated. Please log in to use voice transcription."
    );
  }

  return session.access_token;
}

/**
 * Get the current user's workspace ID
 * Tries to resolve workspace from profiles.current_workspace_id, falls back to user.id
 * This matches the pattern used in noraChatService and other services
 */
async function getWorkspaceId(): Promise<string> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new Error("User not authenticated");
  }

  // Try to resolve workspace from profiles.current_workspace_id; fallback to user.id
  // This ensures the workspaceId matches what the Edge Function expects in users_workspaces_map
  const { data: prof } = await supabase
    .from("profiles")
    .select("current_workspace_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  const workspaceId = prof?.current_workspace_id || user.id;
  return workspaceId;
}

/**
 * Transcribe audio using the Supabase Edge function
 */
export async function transcribeAudio(
  audioBlob: Blob
): Promise<VoiceTranscriptionResponse> {
  try {
    const accessToken = await getAccessToken();
    const workspaceId = await getWorkspaceId();

    // Create FormData with audio file and workspace ID
    const formData = new FormData();
    formData.append("audio", audioBlob, "recording.webm");
    formData.append("workspaceId", workspaceId);

    let response: Response;
    try {
      response = await fetch(VOICE_TRANSCRIPTION_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        body: formData,
      });
    } catch (fetchError) {
      throw new Error(
        fetchError instanceof Error
          ? `Network error: ${fetchError.message}`
          : "Network error: Failed to connect to transcription service"
      );
    }

    if (!response.ok) {
      // Try to get error message from response body
      let errorMessage = `Transcription failed: ${response.status} ${response.statusText}`;
      let errorData: any = null;

      try {
        const text = await response.text();

        // Try to parse as JSON
        try {
          errorData = JSON.parse(text);
          errorMessage = errorData.error || errorData.message || errorMessage;
        } catch {
          // Not JSON, use the text as error message
          if (text) {
            errorMessage =
              text.length > 200 ? text.substring(0, 200) + "..." : text;
          }
        }
      } catch (parseError) {
        // Failed to read error response
      }

      throw new Error(errorMessage);
    }

    // Parse successful response
    let jsonResponse: VoiceTranscriptionResponse;
    try {
      const responseText = await response.text();
      jsonResponse = JSON.parse(responseText);
    } catch (parseError) {
      throw new Error("Invalid response format from transcription service");
    }

    return jsonResponse;
  } catch (error) {
    throw error;
  }
}

/**
 * Voice Recorder class for managing audio recording
 */
export class VoiceRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private stream: MediaStream | null = null;

  /**
   * Check if the browser supports audio recording
   */
  static isSupported(): boolean {
    return !!(
      navigator.mediaDevices &&
      navigator.mediaDevices.getUserMedia &&
      window.MediaRecorder
    );
  }

  /**
   * Request microphone permission and start recording
   */
  async startRecording(): Promise<void> {
    if (!VoiceRecorder.isSupported()) {
      throw new Error("Voice recording is not supported in this browser");
    }

    try {
      // Request microphone access
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 44100,
        },
      });

      // Determine the best supported MIME type
      const mimeType = this.getSupportedMimeType();

      // Create MediaRecorder
      this.mediaRecorder = new MediaRecorder(this.stream, {
        mimeType,
        audioBitsPerSecond: 128000,
      });

      this.audioChunks = [];

      // Collect audio data
      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };

      // Start recording with timeslice to get regular data chunks
      this.mediaRecorder.start(100);
    } catch (error) {
      this.cleanup();
      if (error instanceof Error && error.name === "NotAllowedError") {
        throw new Error(
          "Microphone access denied. Please allow microphone access to use voice input."
        );
      }
      throw error;
    }
  }

  /**
   * Stop recording and return the audio blob
   */
  async stopRecording(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder || this.mediaRecorder.state === "inactive") {
        reject(new Error("No active recording"));
        return;
      }

      this.mediaRecorder.onstop = () => {
        const mimeType = this.mediaRecorder?.mimeType || "audio/webm";
        const audioBlob = new Blob(this.audioChunks, { type: mimeType });
        this.cleanup();
        resolve(audioBlob);
      };

      this.mediaRecorder.onerror = (event) => {
        this.cleanup();
        reject(new Error("Recording error occurred"));
      };

      this.mediaRecorder.stop();
    });
  }

  /**
   * Cancel the current recording
   */
  cancelRecording(): void {
    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      this.mediaRecorder.stop();
    }
    this.cleanup();
  }

  /**
   * Check if currently recording
   */
  isRecording(): boolean {
    return this.mediaRecorder?.state === "recording";
  }

  /**
   * Pause the current recording
   */
  pauseRecording(): void {
    if (this.mediaRecorder && this.mediaRecorder.state === "recording") {
      this.mediaRecorder.pause();
    }
  }

  /**
   * Resume a paused recording
   */
  resumeRecording(): void {
    if (this.mediaRecorder && this.mediaRecorder.state === "paused") {
      this.mediaRecorder.resume();
    }
  }

  /**
   * Check if recording is paused
   */
  isPaused(): boolean {
    return this.mediaRecorder?.state === "paused";
  }

  /**
   * Get the best supported MIME type for audio recording
   */
  private getSupportedMimeType(): string {
    const types = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/mp4",
      "audio/wav",
    ];

    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }

    return "audio/webm"; // Default fallback
  }

  /**
   * Clean up resources
   */
  private cleanup(): void {
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    this.mediaRecorder = null;
    this.audioChunks = [];
  }
}

/**
 * Create a singleton voice recorder instance
 */
let voiceRecorderInstance: VoiceRecorder | null = null;

export function getVoiceRecorder(): VoiceRecorder {
  if (!voiceRecorderInstance) {
    voiceRecorderInstance = new VoiceRecorder();
  }
  return voiceRecorderInstance;
}
